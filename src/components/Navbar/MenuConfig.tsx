/**
 * File: MenuConfig.ts
 * Description:
 *  - กำหนดโครงสร้างเมนู Sidebar / Navbar
 *  - จัดการ Icon, Image และ Role-based Menu
 *
 * Author: Panyapon Phollert (Ton) 66160086
 */

import {
  faHome,
  faServer,
  faBoxArchive,
  faWrench,
  faChartLine,
  faClockRotateLeft,
  faGear,
  faCartShopping,
  faBell,
  faChevronUp,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { UserRole } from "@/utils/RoleEnum";
import type { StaticImageData } from "next/image";
import LogoImg from "../../assets/images/navbar/Logo.png";
import LogoGigaImg from "../../assets/images/navbar/logo-giga.png";

/**
 * Constant: Icons
 * Description:
 *  - Map key สำหรับเรียกใช้ FontAwesome Icon
 *
 * Author: Panyapon Phollert (Ton) 66160086
 */
export const Icons: { [key: string]: IconDefinition } = {
  FASHOPPING: faCartShopping,
  FABELL: faBell,
};

/**
 * Constant: Images
 * Description:
 *  - เก็บ path รูปภาพที่ใช้ใน Navbar
 *
 * Author: Panyapon Phollert (Ton) 66160086
 */
export const Images: { [key: string]: string } = {
  LOGO: (LogoImg as StaticImageData).src,
  LOGO_GIGA: (LogoGigaImg as StaticImageData).src,
};

/**
 * Type: MenuItem
 * Description:
 *  - โครงสร้างข้อมูลเมนู
 *  - รองรับเมนูหลักและ submenu
 *
 * Author: Panyapon Phollert (Ton) 66160086
 */
export type menuItem = {
  key: string; // key สำหรับอ้างอิงเมนู
  label: string; // ชื่อเมนูที่แสดง
  path?: string; // path สำหรับ routing
  icon?: IconDefinition; // icon ด้านซ้าย
  iconRight?: IconDefinition; // icon ด้านขวา (dropdown)
  roles: UserRole[]; // role ที่สามารถเห็นเมนู
  children?: menuItem[]; // submenu (ถ้ามี)
};

/**
 * Constant: MenuConfig
 * Description:
 *  - กำหนดเมนูทั้งหมดของระบบ
 *  - ควบคุมการแสดงผลด้วย role
 *
 * Author: Panyapon Phollert (Ton) 66160086
 */
export const MenuConfig: menuItem[] = [
  {
    key: "home",
    label: "หน้าแรก",
    path: "/home",
    icon: faHome,
    roles: [
      UserRole.ADMIN,
      UserRole.EMPLOYEE,
      UserRole.STAFF,
      UserRole.HOD,
      UserRole.HOS,
      UserRole.TECHNICAL,
    ],
  },
  {
    key: "management_requests",
    label: "จัดการคำร้อง",
    path: "/request-borrow-ticket",
    icon: faServer,
    roles: [UserRole.HOD, UserRole.HOS, UserRole.STAFF],
  },
  {
    key: "management_admin",
    label: "จัดการ",
    icon: faServer,
    iconRight: faChevronUp,
    roles: [
      UserRole.ADMIN,
    ],
    children: [
      {
        key: "requests",
        label: "คำร้อง",
        path: "/request-borrow-ticket",
        roles: [UserRole.ADMIN, UserRole.STAFF],
      },
      {
        key: "users",
        label: "บัญชีผู้ใช้",
        path: "/account-management",
        roles: [UserRole.ADMIN],
      },
      {
        key: "devices_admin",
        label: "คลังอุปกรณ์",
        path: "/inventory",
        roles: [UserRole.ADMIN, UserRole.STAFF],
      },
      {
        key: "chatbot",
        label: "แชทบอท",
        path: "/chatbot", // TODO: Update correct path
        roles: [UserRole.ADMIN, UserRole.STAFF],
      },
      {
        key: "departments",
        label: "แผนกและฝ่ายย่อย",
        path: "/departments-management",
        roles: [UserRole.ADMIN],
      },
      {
        key: "categories",
        label: "หมวดหมู่อุปกรณ์",
        path: "/category",
        roles: [UserRole.ADMIN, UserRole.STAFF],
      },
    ],
  },
  {
    key: "devices",
    label: "รายการอุปกรณ์",
    path: "/list-devices",
    icon: faBoxArchive,
    roles: [
      UserRole.ADMIN,
      UserRole.EMPLOYEE,
      UserRole.HOD,
      UserRole.HOS,
      UserRole.STAFF,
      UserRole.TECHNICAL,
    ],
  },
  {
    key: "repair",
    label: "แจ้งซ่อม",
    path: "/repair", // TODO: Update correct path
    icon: faWrench,
    roles: [
      UserRole.EMPLOYEE,
      UserRole.STAFF,
      UserRole.ADMIN,
      UserRole.HOD,
      UserRole.HOS,
      UserRole.TECHNICAL,
    ],
  },
  {
    key: "dashboard",
    label: "แดชบอร์ด",
    path: "/dashboard",
    icon: faChartLine,
    roles: [
      UserRole.ADMIN,
      UserRole.HOD,
      UserRole.HOS,
      UserRole.STAFF,
      UserRole.TECHNICAL,
    ],
  },
  {
    key: "history",
    label: "ดูประวัติ",
    path: "/history", // TODO: Update correct path
    icon: faClockRotateLeft,
    roles: [
      UserRole.ADMIN,
      UserRole.EMPLOYEE,
      UserRole.HOD,
      UserRole.HOS,
      UserRole.STAFF,
      UserRole.TECHNICAL,
    ],
  },
  {
    key: "setting",
    label: "การตั้งค่า",
    path: "/setting",
    icon: faGear,
    roles: [
      UserRole.ADMIN,
      UserRole.HOD,
      UserRole.HOS,
      UserRole.EMPLOYEE,
      UserRole.STAFF,
      UserRole.TECHNICAL,
    ],
  },
];

/**
 * Function: filterMenuByRole
 * Description:
 *  - กรองเมนูตาม role ของผู้ใช้งาน
 *  - กรอง submenu ตาม role เช่นเดียวกัน
 *  - ใช้งานซ้ำได้ (Reusable)
 * คืนเมนูที่ผ่านการกรองแล้ว
 *
 * Author: Panyapon Phollert (Ton) 66160086
 */
export const filterMenuByRole = (
  menus: menuItem[],
  role: UserRole,
): menuItem[] =>
  menus
    .filter((menu) => menu.roles.includes(role))
    .map((menu) => ({
      ...menu,
      children: menu.children
        ? menu.children.filter((child) => child.roles.includes(role))
        : undefined,
    }));
