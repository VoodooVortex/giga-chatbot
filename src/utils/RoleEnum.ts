/**
 * File: RoleEnum.ts
 * Description:
 *  - กำหนด enum สำหรับ Role ของผู้ใช้งานในระบบ
 *  - กำหนดชื่อ Role ภาษาไทยสำหรับแสดงผลใน UI
 *
 * Author: Panyapon Phollert (Ton) 66160086
 */

/**
 * Enum: UserRole
 * Description:
 *  - ใช้ระบุสิทธิ์และบทบาทของผู้ใช้งานในระบบ
 *  - ใช้ร่วมกับระบบ Authorization และ Menu Permission
 *
 * Author: Panyapon Phollert (Ton) 66160086
 */
export enum UserRole {
  ADMIN = "ADMIN",
  HOD = "HOD",
  HOS = "HOS",
  TECHNICAL = "TECHNICAL",
  STAFF = "STAFF",
  EMPLOYEE = "EMPLOYEE",
}

/**
 * Constant: UserRoleTH
 * Description:
 *  - Map ค่า UserRole → ชื่อภาษาไทย
 *  - ใช้แสดงผล Role ใน UI
 *
 * Author: Panyapon Phollert (Ton) 66160086
 */
export const UserRoleTH: Record<UserRole, string> = {
  [UserRole.ADMIN]: "แอดมิน",
  [UserRole.HOD]: "หัวหน้าแผนก",
  [UserRole.HOS]: "หัวหน้าฝ่ายย่อย",
  [UserRole.TECHNICAL]: "ช่างเทคนิค",
  [UserRole.STAFF]: "เจ้าหน้าที่",
  [UserRole.EMPLOYEE]: "พนักงาน",
};
