import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'http';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AppModule } from '../src/app.module.js';

describe('App (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let tmpDir: string;

  beforeAll(async () => {
    // Create temp triggers config with a webhook trigger
    tmpDir = mkdtempSync(join(tmpdir(), 'agentqueue-e2e-'));
    const triggersPath = join(tmpDir, 'triggers.yaml');
    writeFileSync(
      triggersPath,
      `triggers:
  - name: test-webhook
    type: webhook
    source: github
    events:
      - push
    target: test-repo
    prompt: "Handle push event"
`,
    );

    // Ensure no webhook secret so signature verification is skipped
    delete process.env.GITHUB_WEBHOOK_SECRET;
    process.env.TRIGGERS_CONFIG_PATH = triggersPath;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ rawBody: true });
    app.useGlobalPipes(
      new ValidationPipe({ transform: true, whitelist: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('POST /jobs → 201 with job ID', async () => {
    const res = await request(server)
      .post('/jobs')
      .send({ target: 'my-repo', prompt: 'Fix the bug' })
      .expect(201);

    const body = res.body as { id: string };
    expect(body).toHaveProperty('id');
    expect(typeof body.id).toBe('string');
  });

  it('GET /jobs/:id → returns job status', async () => {
    // First create a job
    const createRes = await request(server)
      .post('/jobs')
      .send({ target: 'my-repo', prompt: 'Check status' })
      .expect(201);

    const { id: jobId } = createRes.body as { id: string };

    const res = await request(server).get(`/jobs/${jobId}`).expect(200);

    const body = res.body as {
      id: string;
      status: string;
      target: string;
      prompt: string;
      createdAt: string;
    };
    expect(body).toHaveProperty('id', jobId);
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('target', 'my-repo');
    expect(body).toHaveProperty('prompt', 'Check status');
    expect(body).toHaveProperty('createdAt');
  });

  it('POST /webhooks/github with matching event → 200 with job IDs', async () => {
    const res = await request(server)
      .post('/webhooks/github')
      .set('x-github-event', 'push')
      .send({ ref: 'refs/heads/main', repository: { name: 'test' } })
      .expect(200);

    const body = res.body as { jobIds: string[] };
    expect(body).toHaveProperty('jobIds');
    expect(Array.isArray(body.jobIds)).toBe(true);
    expect(body.jobIds.length).toBeGreaterThan(0);
  });

  it('POST /webhooks/github with non-matching event → 200 with empty jobIds', async () => {
    const res = await request(server)
      .post('/webhooks/github')
      .set('x-github-event', 'pull_request')
      .send({ action: 'opened' })
      .expect(200);

    const body = res.body as { jobIds: string[] };
    expect(body).toHaveProperty('jobIds');
    expect(body.jobIds).toEqual([]);
  });

  it('GET /admin/queues → returns Bull Board HTML', async () => {
    const res = await request(server).get('/admin/queues').expect(200);

    expect(res.text).toContain('html');
  });
});
