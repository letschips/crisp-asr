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
  // A callout is closed with a blank line; otherwise Markdown lazy
  // continuation pulls every following line into it.
  let afterCallout = false;
  for (let index = 0; index <= lines.length; index += 1) {
    const current = byIndex.get(index) ?? [];
    const line = index < lines.length ? lines[index]?.trim() ?? "" : "";
    const important = current.some((marker) => marker.type === "important");
    const question = current.some((marker) => marker.type === "question");
    const paragraph = current.some((marker) => marker.type === "paragraph");
    if ((important || question || paragraph || afterCallout) && output.length > 0) {
      if (output[output.length - 1] !== "") output.push("");
    }
    afterCallout = false;
    if (important || question) {
      output.push(important
        ? `> [!important] 重点${question ? " · 待确认" : ""}`
        : "> [!question] 待确认");
      if (line) output.push(`> ${line}`);
      afterCallout = true;
      continue;
    }
    if (line) output.push(line);
  }
  return output.join("\n").trim();
}
