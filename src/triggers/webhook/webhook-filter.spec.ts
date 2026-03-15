import {
  getNestedValue,
  evaluateFilter,
  matchesFilters,
} from './webhook-filter.js';
import { WebhookFilter } from '../../config/trigger-config.interface.js';

describe('getNestedValue', () => {
  it('should resolve top-level keys', () => {
    expect(getNestedValue({ action: 'opened' }, 'action')).toBe('opened');
  });

  it('should resolve nested keys', () => {
    const obj = { requested_reviewer: { login: 'bot' } };
    expect(getNestedValue(obj, 'requested_reviewer.login')).toBe('bot');
  });

  it('should resolve deeply nested keys', () => {
    const obj = { a: { b: { c: { d: 42 } } } };
    expect(getNestedValue(obj, 'a.b.c.d')).toBe(42);
  });

  it('should return undefined for missing paths', () => {
    expect(getNestedValue({ a: 1 }, 'b')).toBeUndefined();
    expect(getNestedValue({ a: { b: 1 } }, 'a.c')).toBeUndefined();
  });

  it('should return undefined when traversing through null', () => {
    expect(getNestedValue({ a: null } as never, 'a.b')).toBeUndefined();
  });

  it('should return undefined when traversing through a primitive', () => {
    expect(getNestedValue({ a: 'hello' }, 'a.b')).toBeUndefined();
  });
});

describe('evaluateFilter', () => {
  describe('equals', () => {
    it('should match when value equals', () => {
      const filter: WebhookFilter = { field: 'action', equals: 'opened' };
      expect(evaluateFilter({ action: 'opened' }, filter)).toBe(true);
    });

    it('should not match when value differs', () => {
      const filter: WebhookFilter = { field: 'action', equals: 'opened' };
      expect(evaluateFilter({ action: 'closed' }, filter)).toBe(false);
    });

    it('should stringify non-string values for comparison', () => {
      const filter: WebhookFilter = { field: 'count', equals: '5' };
      expect(evaluateFilter({ count: 5 }, filter)).toBe(true);
    });
  });

  describe('contains', () => {
    it('should match when string contains substring', () => {
      const filter: WebhookFilter = {
        field: 'pull_request.title',
        contains: 'fix',
      };
      const body = { pull_request: { title: 'bugfix: resolve crash' } };
      expect(evaluateFilter(body, filter)).toBe(true);
    });

    it('should not match non-string values', () => {
      const filter: WebhookFilter = { field: 'count', contains: '5' };
      expect(evaluateFilter({ count: 5 }, filter)).toBe(false);
    });

    it('should not match when substring absent', () => {
      const filter: WebhookFilter = { field: 'text', contains: 'hello' };
      expect(evaluateFilter({ text: 'world' }, filter)).toBe(false);
    });
  });

  describe('in', () => {
    it('should match when value is in the list', () => {
      const filter: WebhookFilter = {
        field: 'action',
        in: ['opened', 'synchronize', 'reopened'],
      };
      expect(evaluateFilter({ action: 'synchronize' }, filter)).toBe(true);
    });

    it('should not match when value is not in the list', () => {
      const filter: WebhookFilter = {
        field: 'action',
        in: ['opened', 'synchronize'],
      };
      expect(evaluateFilter({ action: 'closed' }, filter)).toBe(false);
    });
  });

  describe('pattern', () => {
    it('should match when regex matches', () => {
      const filter: WebhookFilter = {
        field: 'ref',
        pattern: '^refs/heads/(main|develop)$',
      };
      expect(evaluateFilter({ ref: 'refs/heads/main' }, filter)).toBe(true);
    });

    it('should not match when regex does not match', () => {
      const filter: WebhookFilter = {
        field: 'ref',
        pattern: '^refs/heads/main$',
      };
      expect(evaluateFilter({ ref: 'refs/heads/feature' }, filter)).toBe(
        false,
      );
    });
  });

  describe('no condition', () => {
    it('should pass when no condition is specified', () => {
      const filter: WebhookFilter = { field: 'anything' };
      expect(evaluateFilter({ anything: 'value' }, filter)).toBe(true);
    });
  });
});

describe('matchesFilters', () => {
  it('should return true when filters is undefined', () => {
    expect(matchesFilters({ action: 'opened' }, undefined)).toBe(true);
  });

  it('should return true when filters is empty', () => {
    expect(matchesFilters({ action: 'opened' }, [])).toBe(true);
  });

  it('should return true when all filters match', () => {
    const filters: WebhookFilter[] = [
      { field: 'action', equals: 'review_requested' },
      { field: 'requested_reviewer.login', equals: 'my-bot' },
    ];
    const body = {
      action: 'review_requested',
      requested_reviewer: { login: 'my-bot' },
    };
    expect(matchesFilters(body, filters)).toBe(true);
  });

  it('should return false when any filter does not match', () => {
    const filters: WebhookFilter[] = [
      { field: 'action', equals: 'review_requested' },
      { field: 'requested_reviewer.login', equals: 'my-bot' },
    ];
    const body = {
      action: 'review_requested',
      requested_reviewer: { login: 'someone-else' },
    };
    expect(matchesFilters(body, filters)).toBe(false);
  });

  it('should work with mixed filter types', () => {
    const filters: WebhookFilter[] = [
      { field: 'action', in: ['opened', 'synchronize'] },
      { field: 'pull_request.title', contains: 'feat' },
      { field: 'ref', pattern: '^refs/heads/' },
    ];
    const body = {
      action: 'opened',
      pull_request: { title: 'feat: add new thing' },
      ref: 'refs/heads/my-branch',
    };
    expect(matchesFilters(body, filters)).toBe(true);
  });
});
