export const TEST_EVENT_ID = 20251925;
export const TEST_EVENT_KEY = "test:otr2025";
export const TEST_EVENT_NAME = "Test Event — Oregon Trail Rally 2025";

export function isTestEventId(id: string | number | null | undefined): boolean {
  if (id == null) return false;
  const s = String(id);
  return s === String(TEST_EVENT_ID) || s === "TEST_OTR_2025";
}

export function testEventRow() {
  return {
    key: TEST_EVENT_KEY,
    name: TEST_EVENT_NAME,
    eventId: TEST_EVENT_ID,
    source: "rallysafe" as const,
    ewrcId: null as number | null,
    rallysafeId: TEST_EVENT_ID,
    done: false,
    from: "2025-05-16",
    until: "2025-05-18",
  };
}
