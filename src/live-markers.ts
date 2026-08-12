export type LiveMarkerType = "important" | "paragraph" | "question";

export interface LiveMarker {
  id: string;
  type: LiveMarkerType;
  utteranceIndex: number;
  atMs: number;
}

export function normalizeLiveMarkers(value: unknown): LiveMarker[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): LiveMarker[] => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const item = entry as Record<string, unknown>;
    const type = item.type;
    if (type !== "important" && type !== "paragraph" && type !== "question") {
      return [];
    }
    const utteranceIndex = typeof item.utteranceIndex === "number"
      ? Math.max(0, Math.floor(item.utteranceIndex))
      : 0;
    return [{
      id: typeof item.id === "string" && item.id.trim() ? item.id : `${type}-${utteranceIndex}`,
      type,
      utteranceIndex,
      atMs: typeof item.atMs === "number" && Number.isFinite(item.atMs)
        ? Math.max(0, item.atMs)
        : 0,
    }];
  });
}

export function renderMarkedTranscript(
  lines: readonly string[],
  markers: readonly LiveMarker[],
): string {
  const byIndex = new Map<number, LiveMarker[]>();
  for (const marker of markers) {
    const list = byIndex.get(marker.utteranceIndex) ?? [];
    list.push(marker);
    byIndex.set(marker.utteranceIndex, list);
  }
  const output: string[] = [];
  for (let index = 0; index <= lines.length; index += 1) {
    const current = byIndex.get(index) ?? [];
    if (current.some((marker) => marker.type === "paragraph") && output.length > 0) {
      output.push("");
    }
    if (current.some((marker) => marker.type === "important")) output.push("> [!important] 重点");
    if (current.some((marker) => marker.type === "question")) output.push("> [!question] 待确认");
    if (index < lines.length && lines[index]?.trim()) output.push(lines[index]!.trim());
  }
  return output.join("\n").trim();
}
