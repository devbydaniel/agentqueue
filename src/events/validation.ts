export const JOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function validateJobId(jobId: string): void {
  if (!JOB_ID_PATTERN.test(jobId)) {
    throw new Error(`Invalid jobId: ${jobId}`);
  }
}
