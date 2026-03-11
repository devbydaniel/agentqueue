export function relativeTime(date: Date | string): string {
  const now = Date.now();
  const then =
    typeof date === 'string' ? new Date(date).getTime() : date.getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return `${diffSec.toString()}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin.toString()}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr.toString()}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay.toString()}d ago`;
}

export function truncate(str: string, len: number): string {
  if (str.length <= len) return str;
  return str.slice(0, len - 1) + '…';
}

const TOOL_ICONS: Record<string, string> = {
  read: '📖',
  bash: '🔧',
  edit: '✏️',
  write: '✍️',
};

export function toolIcon(toolName: string): string {
  return TOOL_ICONS[toolName.toLowerCase()] ?? '🔹';
}

// ANSI color helpers
export const color = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

export function colorStatus(status: string): string {
  switch (status) {
    case 'completed':
      return color.green(status);
    case 'failed':
      return color.red(status);
    case 'active':
    case 'waiting':
    case 'delayed':
      return color.yellow(status);
    default:
      return status;
  }
}
