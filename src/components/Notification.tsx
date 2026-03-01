import React from "react";
import { Icon } from "@iconify/react";

/**
 * Description: ประเภทของการแจ้งเตือนที่รองรับในระบบ
 * Author     : Pakkapon Chomchoey (Tonnam) 66160080
 */
export type NotificationType =
  | "approved"
  | "returned"
  | "in_use"
  | "warning"
  | "overdue"
  | "repair_success"
  | "repair_failed"
  | "repair_new"
  | "request_new"
  | "request_pending"
  | "rejected"
  | "request_fulfill"
  | "request_resolve"
  | "general";

/**
 * Description: Props สำหรับ NotificationItem component
 * Author     : Pakkapon Chomchoey (Tonnam) 66160080
 */
export interface NotificationItemProps {
  id?: number;
  type: NotificationType;
  title: string;
  description: React.ReactNode;
  timestamp: string;
  isRead?: boolean;
  onClick?: () => void;
}

/**
 * Description: คืนค่า icon และสีตามประเภทการแจ้งเตือน
 * Input      : type (NotificationType)
 * Output     : { icon: string, color: string, iconColor: string }
 * Author     : Pakkapon Chomchoey (Tonnam) 66160080
 */
const getIconAndColor = (type: NotificationType) => {
  switch (type) {
    case "approved":
      return {
        icon: "material-symbols:check-rounded",
        color: "bg-[#00AA1A]",
        iconColor: "text-white",
      };
    case "returned":
      return {
        icon: "streamline:return-2",
        color: "bg-[#00AA1A]",
        iconColor: "text-white",
      }; // Green for returned
    case "in_use":
      return {
        icon: "solar:box-outline",
        color: "bg-[#40A9FF]",
        iconColor: "text-white",
      }; // Blue for in_use
    case "warning":
      return {
        icon: "mdi-clock-alert-outline",
        color: "bg-[#FF7A45]",
        iconColor: "text-white",
      }; // Orange for nearing due
    case "overdue":
      return {
        icon: "famicons:alert-circle-outline",
        color: "bg-[#FF4D4F]",
        iconColor: "text-white",
      }; // Red for overdue
    case "repair_success":
      return {
        icon: "system-uicons:clipboard-check",
        color: "bg-[#2563EB]",
        iconColor: "text-white",
      }; // Blue for repair success
    // case "repair_failed":
    //   return {
    //     icon: "mdi:clipboard-alert-outline",
    //     color: "bg-[#2962FF]",
    //     iconColor: "text-white",
    //   }; // Blue for repair failed
    case "repair_new":
      return {
        icon: "ph:wrench",
        color: "bg-[#40A9FF]",
        iconColor: "text-white",
      }; // Light blue for new repair
    case "request_new":
      return {
        icon: "famicons:alert-circle-outline",
        color: "bg-[#40A9FF]",
        iconColor: "text-white",
      }; // Light blue for new request
    case "request_pending":
      return {
        icon: "mdi-clock-alert-outline",
        color: "bg-[#FF7A45]",
        iconColor: "text-white",
      }; // Orange for pending
    case "rejected":
      return {
        icon: "maki:cross",
        color: "bg-[#FF4D4F]",
        iconColor: "text-white",
      }; // Red for rejected
    case "request_resolve":
    case "request_fulfill":
      return {
        icon: "material-symbols:check-rounded",
        color: "bg-[#737373]",
        iconColor: "text-white",
      };
    case "general":
    default:
      return {
        icon: "mdi:bell",
        color: "bg-[#6366f1]", // Indigo-500 to match toast
        iconColor: "text-white",
      };
  }
};

/**
 * Description: แสดงรายการแจ้งเตือนแต่ละรายการ พร้อม icon, title, description, timestamp
 * Input      : NotificationItemProps { type, title, description, timestamp, isRead, onClick }
 * Output     : JSX.Element
 * Author     : Pakkapon Chomchoey (Tonnam) 66160080
 */
export const NotificationItem: React.FC<NotificationItemProps> = ({
  type,
  title,
  description,
  timestamp,
  isRead = false,
  onClick,
}) => {
  const { icon, color, iconColor } = getIconAndColor(type);

  return (
    <div
      onClick={onClick}
      className={`flex items-start p-4 border-b border-gray-100 hover:bg-gray-50 cursor-pointer transition-colors ${!isRead ? "bg-white" : "bg-[#F8FAFC]"
        }`}
    >
      {/* Icon Circle */}
      <div
        className={`flex-shrink-0 w-12 h-12 rounded-full ${color} flex items-center justify-center mr-4`}
      >
        <Icon icon={icon} className={`w-8 h-8 ${iconColor}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex justify-between items-baseline">
          <h4 className="text-lg font-bold text-gray-900 truncate pr-2">
            {title}
          </h4>
          <span className="text-sm text-gray-500 whitespace-nowrap flex-shrink-0">
            {timestamp}
          </span>
        </div>
        <div
          className={`text-base break-words ${type === "overdue" ? "text-[#FF4D4F]" : "text-[#565656]"}`}
        >
          {description}
        </div>
      </div>
    </div>
  );
};

/**
 * Description: Props สำหรับ NotificationList component
 * Author     : Pakkapon Chomchoey (Tonnam) 66160080
 */
export interface NotificationListProps {
  notifications: NotificationItemProps[];
  onClose: () => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

/**
 * Description: แสดงรายการแจ้งเตือนทั้งหมดในกล่อง popup พร้อม infinite scroll
 * Input      : NotificationListProps { notifications, onClose, onLoadMore, hasMore }
 * Output     : JSX.Element
 * Author     : Pakkapon Chomchoey (Tonnam) 66160080
 */
export const NotificationList: React.FC<NotificationListProps> = ({
  notifications,
  onClose,
  onLoadMore,
  hasMore,
}) => {
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      // Load when close to bottom
      if (onLoadMore) onLoadMore();
    }
  };

  return (
    <div className="w-[480px] bg-white rounded-xl shadow-2xl overflow-hidden border border-gray-200 flex flex-col max-h-[80vh]">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white sticky top-0 z-10">
        <h3 className="text-xl font-bold text-gray-800">การแจ้งเตือน</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-full hover:bg-gray-100"
        >
          <Icon icon="mdi:close" className="w-6 h-6" />
        </button>
      </div>

      {/* List */}
      <div
        onScroll={handleScroll}
        className="overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-transparent"
      >
        {notifications.length > 0 ? (
          <>
            {notifications.map((notif, index) => (
              <NotificationItem key={notif.id || index} {...notif} />
            ))}
            {hasMore && (
              <div className="p-4 text-center text-gray-500 text-sm">
                LOADING...
              </div>
            )}
            {!hasMore && notifications.length > 0 && (
              <div className="p-4 text-center text-gray-400 text-xs"></div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Icon
              icon="mdi:bell-off-outline"
              className="w-16 h-16 mb-2 opacity-50"
            />
            <p>ไม่มีการแจ้งเตือน</p>
          </div>
        )}
      </div>
    </div>
  );
};

/**
 * Description: Props สำหรับ NotificationBell component
 * Author     : Pakkapon Chomchoey (Tonnam) 66160080
 */
export interface NotificationBellProps {
  count?: number;
  onClick?: () => void;
}

/**
 * Description: ปุ่มกระดิ่งแจ้งเตือน พร้อมแสดง badge จำนวนที่ยังไม่อ่าน
 * Input      : NotificationBellProps { count, onClick }
 * Output     : JSX.Element
 * Author     : Pakkapon Chomchoey (Tonnam) 66160080
 */
export const NotificationBell: React.FC<NotificationBellProps> = ({
  count = 0,
  onClick,
}) => {
  return (
    <button
      onClick={onClick}
      className="relative w-10 h-10 bg-white rounded-full border-2 border-black flex items-center justify-center hover:bg-gray-50 transition-colors"
    >
      <Icon icon="mdi:bell" className="text-black w-5 h-5" />
      {count > 0 && (
        <span className="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-white"></span>
      )}
    </button>
  );
};
