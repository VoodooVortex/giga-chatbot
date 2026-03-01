/**
 * Description: สร้าง key สำหรับเก็บ snapshot ของ cart ที่ผู้ใช้ "เห็นแล้ว" (ต่อ user)
 * Input : userId (number)
 * Output : string (storage key)
 * Author : Nontapat Sinhum (Guitar) 66160104
 **/
const key = (userId: number) => `orbis_cart_seen_v2_${userId}`;

/**
 * Description: โครงสร้าง snapshot แบบใหม่ (v2) เก็บ updatedAt ต่อ cartItemId
 * Input : -
 * Output : CartSeenSnapshotV2
 * Author : Nontapat Sinhum (Guitar) 66160104
 **/
export type CartSeenSnapshotV2 = {
  map: Record<number, string>; // { [cti_id]: updated_at_iso }
};

/**
 * Description: อ่าน snapshot ล่าสุดที่ผู้ใช้ "เห็นแล้ว" จาก localStorage
 * Input : userId (number)
 * Output : CartSeenSnapshotV2 (map ของ cti_id -> updated_at_iso)
 * Author : Nontapat Sinhum (Guitar) 66160104
 **/
export function getSeenCartSnapshot(userId: number): CartSeenSnapshotV2 {
  try {
    const raw = localStorage.getItem(key(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;

    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as any).map &&
      typeof (parsed as any).map === "object"
    ) {
      return parsed as CartSeenSnapshotV2;
    }

    return { map: {} };
  } catch {
    return { map: {} };
  }
}

/**
 * Description: บันทึก snapshot ตอนผู้ใช้ "เปิดหน้า cart" (ถือว่าเห็นแล้ว)
 * Input : userId (number), items ({ id, updatedAt, createdAt }[])
 * Output : void
 * Author : Nontapat Sinhum (Guitar) 66160104
 **/
export function setSeenCartSnapshot(
  userId: number,
  items: Array<{
    id: number;
    updatedAt?: string | null;
    createdAt?: string | null;
  }>,
): void {
  try {
    const map: Record<number, string> = {};

    for (const it of items) {
      const ts = it.updatedAt ?? it.createdAt ?? new Date().toISOString();
      map[it.id] = ts;
    }

    localStorage.setItem(key(userId), JSON.stringify({ map }));
  } catch {
    // ignore
  }
}
