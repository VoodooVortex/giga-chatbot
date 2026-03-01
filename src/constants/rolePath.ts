// กำหนด prefix ของแต่ละ role
export const ROLE_BASE_PATH = {
    ADMIN: "administrator",
    HOD: "hod",
    HOS: "hos",
    STAFF: "staff",
    TECHNICAL: "technical"
} as const;

export type Role = keyof typeof ROLE_BASE_PATH; // สร้าง type จาก ROLE_BASE_PATH

// แปลงจาก role เป็น path นำหน้าจาก prefix
export const getBasePath = (role: string | null | undefined) => {
    if (!role) return null;

    // แปลง role จาก string ให้เป็น type Role เพื่อใช้ map
    const key = role as Role;

    // คืนค่า path นำหน้า
    return `/${ROLE_BASE_PATH[key]}`;
}