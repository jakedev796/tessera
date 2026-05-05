const GLOBAL_KEY = Symbol.for('tessera.worktreeDiffAutoPromoteSuppressedTasks');
const g = globalThis as unknown as { [GLOBAL_KEY]?: Set<string> };

function getSuppressedTaskIds(): Set<string> {
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Set<string>();
  }
  return g[GLOBAL_KEY]!;
}

export function suppressDiffAutoPromoteForTask(taskId: string): void {
  getSuppressedTaskIds().add(taskId);
}

export function filterDiffAutoPromoteTaskIds(taskIds: string[]): string[] {
  const suppressed = getSuppressedTaskIds();
  if (suppressed.size === 0) return taskIds;
  return taskIds.filter((taskId) => !suppressed.has(taskId));
}

export function clearDiffAutoPromoteSuppressionsForTest(): void {
  getSuppressedTaskIds().clear();
}
