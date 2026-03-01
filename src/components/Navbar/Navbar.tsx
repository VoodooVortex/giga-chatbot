"use client";

/**
 * Component: Navbar
 * Features:
 *  - แสดง Topbar + Sidebar
 *  - แสดงเมนูตาม Role ของผู้ใช้งาน
 *  - รองรับเมนูแบบมี Submenu (Dropdown)
 *  - แสดงข้อมูลผู้ใช้จาก localStorage / sessionStorage
 *  - รองรับ Notification และ Cart icon
 *  - จัดการ Logout และ redirect ไปหน้า Login
 *
 * Author: Panyapon Phollert (Ton) 66160086
 */

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { Icon } from "@iconify/react";
import { useUserStore } from "@/stores/userStore";
import { UserRole, UserRoleTH } from "@/utils/RoleEnum";
import { MenuConfig, filterMenuByRole } from "./MenuConfig";
import getImageUrl from "@/services/GetImage";
import { type menuItem, Images, Icons } from "./MenuConfig";
import { getBasePath } from "@/constants/rolePath";
import { useNotifications } from "@/hooks/useNotifications";
import { NotificationList } from "@/components/Notification";
import CartService from "@/services/CartService";
import {
  getSeenCartSnapshot,
  setSeenCartSnapshot,
} from "@/utils/cartSeenStorage";

interface NavbarProps {
  children?: ReactNode;
}

const Navbar = ({ children }: NavbarProps) => {
  const { logout } = useUserStore();

  const user =
    typeof window !== "undefined"
      ? JSON.parse(
          localStorage.getItem("User") ||
            sessionStorage.getItem("User") ||
            "null",
        )
      : null;

  const role = user?.us_role as UserRole;
  const menus = filterMenuByRole(MenuConfig, role);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isDropdownOpen, setDropdownOpen] = useState(false);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [activeSubMenu, setActiveSubMenu] = useState<string | null>(null);
  const [active, setActive] = useState<"bell" | "cart" | null>(null);
  const pathname = usePathname();

  const userId = user?.us_id as number | undefined;

  const [hasNewCartItems, setHasNewCartItems] = useState(false);
  const [cartUnseenCount, setCartUnseenCount] = useState(0);

  const isOnCartPage = pathname
    .toLowerCase()
    .includes("/list-devices/cart");

  /**
   * Description: แปลง/normalize ข้อมูลจาก API ให้อยู่ในรูปแบบที่ใช้เช็ค snapshot ได้เสมอ
   * Input : itemData (any[])
   * Output : { id: number, updatedAt: string | null, createdAt: string | null }[]
   * Author : Nontapat Sinhum (Guitar) 66160104
   **/
  const normalizeCartItemsForSeen = useCallback((itemData: any[]) => {
    return (itemData ?? []).map((i: any) => ({
      id: i.cti_id,
      updatedAt: i.updated_at ?? i.cti_updated_at ?? null,
      createdAt: i.created_at ?? i.cti_created_at ?? null,
    }));
  }, []);

  const MIN_CART_CHECK_MS = 2500;

  const cartCheckRef = useRef({
    inFlight: false,
    lastAt: 0,
    queued: false,
  });

  /**
   * Description: เช็คว่ามี cart item "ใหม่/ถูกแก้ไข" เมื่อเทียบกับ snapshot ตอนผู้ใช้เปิดหน้า cart ล่าสุด
   * Input : userId (number)
   * Output : Promise<void>
   * Author : Nontapat Sinhum (Guitar) 66160104
   **/
  const checkCartNewItems = useCallback(async () => {
    try {
      if (!userId) return;
      if (isOnCartPage) return; // อยู่หน้า cart อยู่แล้ว ไม่ต้องเช็ค badge ถี่ ๆ

      const now = Date.now();

      // throttle: ถี่เกินไปไม่ต้องยิง
      if (now - cartCheckRef.current.lastAt < MIN_CART_CHECK_MS) return;

      // กันซ้อน: ถ้ากำลังยิงอยู่ ให้คิวไว้ 1 ครั้ง
      if (cartCheckRef.current.inFlight) {
        cartCheckRef.current.queued = true;
        return;
      }

      cartCheckRef.current.inFlight = true;
      cartCheckRef.current.lastAt = now;

      const res = await CartService.getCartItems();
      const serverItems = normalizeCartItemsForSeen(res.itemData);
      const seen = getSeenCartSnapshot(userId).map;

      const unseen = serverItems.filter((it) => {
        const prevTs = seen[it.id];
        const nowTs = it.updatedAt ?? it.createdAt;
        if (!prevTs) return true;
        if (!nowTs) return false;
        return new Date(nowTs).getTime() > new Date(prevTs).getTime();
      });

      setHasNewCartItems(unseen.length > 0);
      setCartUnseenCount(unseen.length);
    } catch (err) {
      console.error("checkCartNewItems error:", err);
    } finally {
      cartCheckRef.current.inFlight = false;

      // ถ้ามีคิวค้างไว้ ให้ยิงซ้ำ “ครั้งเดียว” หลังจากปล่อย
      if (cartCheckRef.current.queued) {
        cartCheckRef.current.queued = false;
        setTimeout(() => {
          void checkCartNewItems();
        }, MIN_CART_CHECK_MS);
      }
    }
  }, [userId, isOnCartPage, normalizeCartItemsForSeen]);

  // สำหรับเช็คเมื่อ mount/focus
  useEffect(() => {
    checkCartNewItems();

    const onFocus = () => checkCartNewItems();
    window.addEventListener("focus", onFocus);

    const onCartChanged = () => checkCartNewItems();
    window.addEventListener("cart:changed", onCartChanged as EventListener);

    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(
        "cart:changed",
        onCartChanged as EventListener,
      );
    };
  }, [checkCartNewItems]);

  /**
   * Description: เมื่อเข้าหน้า cart ให้ mark ว่าเห็นแล้ว (อัปเดต snapshot: id + updated_at)
   * Input : isOnCartPage, userId
   * Output : Promise<void> (อัปเดต localStorage + reset badge state)
   * Author : Nontapat Sinhum (Guitar) 66160104
   **/
  useEffect(() => {
    if (!isOnCartPage) return;
    if (!userId) return;

    (async () => {
      try {
        const res = await CartService.getCartItems();
        const items = normalizeCartItemsForSeen(res.itemData);

        setSeenCartSnapshot(userId, items);
        setHasNewCartItems(false);
        setCartUnseenCount(0);
      } catch (err) {
        console.error("markCartSeen(v2) error:", err);
      }
    })();
  }, [isOnCartPage, userId]);

  // Sync sidebar activeMenu with URL when navigating (e.g., from notification)
  useEffect(() => {
    const path = pathname.toLowerCase();

    // Main menus
    if (path.includes("/home")) {
      setActiveMenu("home");
      setOpenMenu(null);
      setDropdownOpen(false);
    } else if (path.includes("/history")) {
      setActiveMenu("history");
      setOpenMenu(null);
      setDropdownOpen(false);
    } else if (path.includes("/list-devices") && !path.includes("/cart")) {
      setActiveMenu("devices");
      setOpenMenu(null);
      setDropdownOpen(false);
    } else if (path.includes("/repair")) {
      setActiveMenu("repair");
      setOpenMenu(null);
      setDropdownOpen(false);
    } else if (path.includes("/dashboard")) {
      setActiveMenu("dashboard");
      setOpenMenu(null);
      setDropdownOpen(false);
    } else if (path.includes("/setting")) {
      setActiveMenu("setting");
      setOpenMenu(null);
      setDropdownOpen(false);
    }
    // Submenus under "จัดการ" (management_admin)
    else if (path.includes("/request-borrow-ticket")) {
      setActiveMenu("management_requests"); // For HOD/HOS/STAFF
      setActiveSubMenu("คำร้อง");
      setOpenMenu("จัดการ");
      setDropdownOpen(true);
    } else if (path.includes("/account-management")) {
      setActiveMenu("management_admin");
      setActiveSubMenu("บัญชีผู้ใช้");
      setOpenMenu("จัดการ");
      setDropdownOpen(true);
    } else if (path.includes("/inventory")) {
      setActiveMenu("management_admin");
      setActiveSubMenu("คลังอุปกรณ์");
      setOpenMenu("จัดการ");
      setDropdownOpen(true);
    } else if (path.includes("/chatbot")) {
      setActiveMenu("management_admin");
      setActiveSubMenu("แชทบอท");
      setOpenMenu("จัดการ");
      setDropdownOpen(true);
    } else if (path.includes("/departments-management")) {
      setActiveMenu("management_admin");
      setActiveSubMenu("แผนกและฝ่ายย่อย");
      setOpenMenu("จัดการ");
      setDropdownOpen(true);
    } else if (path.includes("/category")) {
      setActiveMenu("management_admin");
      setActiveSubMenu("หมวดหมู่อุปกรณ์");
      setOpenMenu("จัดการ");
      setDropdownOpen(true);
    }
  }, [pathname]);
  const [User, setUser] = useState(() => {
    if (typeof window === "undefined") return null;
    const data = localStorage.getItem("User") || sessionStorage.getItem("User");
    return data ? JSON.parse(data) : null;
  });

  const handleOpenNotifications = useCallback(() => setActive("bell"), []);

  const { notifications, unreadCount, loadMore, hasMore } = useNotifications({
    onOpenNotifications: handleOpenNotifications,
  });

  const basePath = getBasePath(User?.us_role) || "";

  useEffect(() => {
    let reloadTimeout: ReturnType<typeof setTimeout> | null = null;

    const handleStorageChange = () => {
      const data =
        localStorage.getItem("User") || sessionStorage.getItem("User");

      const parsed = data ? JSON.parse(data) : null;

      if (JSON.stringify(parsed) !== JSON.stringify(User)) {
        reloadTimeout = setTimeout(() => {
          window.location.reload();
        }, 2000);
      }

      setUser(parsed);
    };

    window.addEventListener("user-updated", handleStorageChange);

    return () => {
      window.removeEventListener("user-updated", handleStorageChange);
      if (reloadTimeout) clearTimeout(reloadTimeout);
    };
  }, [User]);

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  const toggleDropdown = () => {
    setDropdownOpen(!isDropdownOpen);
  };

  const closeDropdown = () => {
    setDropdownOpen(false);
    setActiveSubMenu("");
  };

  const handleMenuClick = (menu: string) => {
    setActiveMenu(menu);
  };

  const handleSubMenuClick = (menu: string) => {
    setActiveSubMenu(menu);
  };

  const renderMenu = (menu: menuItem) => {
    if (menu.children?.length) {
      return (
        <div key={menu.label}>
          <div
            onClick={() => {
              setOpenMenu(openMenu === menu.label ? null : menu.label);
              toggleDropdown();
              handleMenuClick(menu.label);
            }}
            className={`px-7.5 flex items-center w-full cursor-pointer gap-[11px]  py-[11px] text-lg  rounded-[9px] select-none transition-colors duration-200 ${
              isDropdownOpen ? "bg-[#40A9FF] text-white" : "hover:bg-[#F0F0F0]"
            }`}
          >
            {menu.icon && <FontAwesomeIcon icon={menu.icon} />}
            {menu.label}
            {menu.iconRight && (
              <FontAwesomeIcon
                icon={menu.iconRight}
                className={`mt-1 transform transition-all duration-500 ease-in-out ${
                  isDropdownOpen ? "rotate-0" : "rotate-180"
                }`}
              />
            )}
          </div>
          <div
            className={`overflow-hidden transition-all duration-500 ease-in-out flex flex-col  gap-1
    ${
      openMenu === menu.label
        ? "max-h-[500px] opacity-100 py-2.5"
        : "max-h-0 opacity-0"
    }`}
          >
            {menu.children?.map((child) => (
              <a
                key={child.key}
                href={`${basePath}${child.path!}`}
                onClick={() => handleSubMenuClick(child.label)}
                className={`px-15 rounded-[9px] py-[11px] flex items-center w-full whitespace-nowrap
        ${
          activeSubMenu === child.label
            ? "bg-[#EBF3FE] text-[#40A9FF]"
            : "hover:bg-[#F0F0F0]"
        }`}
              >
                {child.label}
              </a>
            ))}
          </div>
        </div>
      );
    }

    return (
      <a
        key={menu.key}
        href={`${basePath}${menu.path!}`}
        onClick={() => {
          closeDropdown();
          handleMenuClick(menu.key);
        }}
        className={`px-7.5 rounded-[9px] py-[11px] flex items-center w-full gap-2 ${activeMenu === menu.key ? "bg-[#40A9FF] text-white" : "hover:bg-[#F0F0F0]"}`}
      >
        {menu.icon && <FontAwesomeIcon icon={menu.icon} />}
        {menu.label}
      </a>
    );
  };

  return (
    <div className="flex flex-col bg-[#FAFAFA] w-full min-h-screen">
      <div className="fixed  w-full bg-[linear-gradient(to_right,#ffffff_0%,#ffffff_75%,#e7f7ff_90%,#dcf3ff_100%)] text-white px-4  h-[100px] flex justify-between items-center  top-0 left-0 z-50">
        <div className="flex gap-15 justify-center z-51">
          <div className="px-7.5">
            <img src={Images["LOGO"]} alt="" className=" w-[264px] h-[67px]" />
          </div>
          <div
            onClick={() => window.location.assign("/chat")}
            className="flex border border-[#40A9FF] cursor-pointer gap-[15px] px-5 text-[#40A9FF] font-medium items-center rounded-[12px]"
          >
            <img
              src={Images["LOGO_GIGA"]}
              alt=""
              className="w-[26px] h-[30px]"
            />
            <span>คุยกับ GiGa</span>
          </div>
        </div>

        <div className="flex items-center  h-full">
          <div className="relative h-full flex items-center">
            <button
              type="button"
              onClick={() => setActive(active === "bell" ? null : "bell")}
              className={`h-full px-6.5 ${
                active === "bell" ? "bg-[#40A9FF]" : "hover:bg-[#F0F0F0]"
              } flex justify-center items-center relative`}
            >
              {unreadCount > 0 && (
                <div className="w-2 h-2 bg-[#FF4D4F] rounded-full border-white border absolute -mt-2 ml-3"></div>
              )}
              <FontAwesomeIcon
                icon={Icons["FABELL"]}
                className={`text-[23px] ${
                  active === "bell" ? "text-white" : "text-[#595959]"
                }`}
              />
            </button>

            {active === "bell" && (
              <div className="absolute top-[100%] right-0 mt-2 z-50 shadow-xl">
                <NotificationList
                  notifications={notifications}
                  onClose={() => setActive(null)}
                  onLoadMore={loadMore}
                  hasMore={hasMore}
                />
              </div>
            )}
          </div>

          {/* <button
            type="button"
            onClick={() => {
              setActive(active === "cart" ? null : "cart");
              navigate("/list-devices/cart");
            }}
            className={`h-full px-6.5 ${
              active === "cart" ? "bg-[#40A9FF]" : "hover:bg-[#F0F0F0]"
            } flex justify-center items-center relative`}
          >
            {active !== "cart" && (
              <div className="w-2 h-2 bg-[#FF4D4F] rounded-full border-white border absolute -mt-4 ml-5"></div>
            )}
            {hasNewCartItems && !isOnCartPage && (
              <div
                className="w-2 h-2 bg-[#FF4D4F] rounded-full border-white border absolute -mt-4 ml-5"
                title={`มีรายการใหม่ ${cartUnseenCount} รายการ`}
              />
            )}
            <FontAwesomeIcon
              icon={Icons["FASHOPPING"]}
              className={`text-[23px] ${
                active === "cart" ? "text-white" : "text-[#595959]"
              }`}
            />
          </button> */}
          <button
            type="button"
            onClick={() => {
              setActive(null);
              window.location.href = "/list-devices/cart";
            }}
            className={`h-full px-6.5 ${
              isOnCartPage ? "bg-[#40A9FF]" : "hover:bg-[#F0F0F0]"
            } flex justify-center items-center relative`}
          >
            {hasNewCartItems && !isOnCartPage && (
              <div
                className="w-2 h-2 bg-[#FF4D4F] rounded-full border-white border absolute -mt-4 ml-5"
                title={`มีรายการใหม่ ${cartUnseenCount} รายการ`}
              />
            )}

            <FontAwesomeIcon
              icon={Icons["FASHOPPING"]}
              className={`text-[23px] ${isOnCartPage ? "text-white" : "text-[#595959]"}`}
            />
          </button>

          <div className="flex gap-5 items-centerx border-l border-l-[#D9D9D9] ml-[21px] pl-11  pr-1 ">
            <a
              href="/profile"
              className="p-2.5 border border-[#40A9FF] flex gap-5 rounded-xl"
            >
              <img
                src={getImageUrl(user?.us_images)}
                alt=""
                className="w-9 h-9 rounded-full"
              />
              <div className=" text-left text-black pr-8">
                <div className="text-[16px] font-semibold">
                  {user?.us_firstname}
                </div>
                <div className="text-[13px] font-normal">
                  {user?.us_role ? UserRoleTH[user.us_role as UserRole] : ""}
                </div>
              </div>
            </a>
          </div>
        </div>
      </div>
      <div className="flex">
        <aside className="fixed  mt-[100px] w-[213px] bg-white text-black shadow-xl z-40">
          <div className="flex flex-col justify-between h-[calc(100vh-100px)] px-2 py-4 text-lg whitespace-nowrap">
            <nav className="text-left">{menus.map(renderMenu)}</nav>

            <div className="text-left mb-[31px]">
              <button
                onClick={handleLogout}
                className="px-7.5  py-[11px]  flex  items-center gap-3   hover:text-black hover:bg-[#F7F7F7] rounded-md  w-full"
              >
                <Icon icon="ic:outline-logout" width="24" height="24" />
                <span className="">ออกจากระบบ</span>
              </button>
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 bg-[#FAFAFA] ml-[213px] mt-[100px]">
          {children}
        </main>
      </div>
    </div>
  );
};

export default Navbar;
