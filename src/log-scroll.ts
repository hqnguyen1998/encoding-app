export interface LogScrollContainer {
  scrollHeight: number;
  scrollTop: number;
}

export function scrollLogContainerToEnd(container: LogScrollContainer | null): void {
  if (!container) return;
  container.scrollTop = container.scrollHeight;
}
