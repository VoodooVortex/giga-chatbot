/**
 * Description: Service สำหรับเรียก API ตะกร้าจาก Backend (Cart / Borrow)
 * Output : CartService (object) สำหรับเรียกใช้งาน API
 * Author : Nontapat Sinthum (Guitar) 66160104
 */

const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE ||
    (typeof window !== "undefined"
        ? `${window.location.protocol}//${window.location.hostname}:4041/api/v1`
        : "http://localhost:4041/api/v1");

async function apiFetch<T>(
    path: string,
    options?: RequestInit,
): Promise<T> {
    const token =
        typeof window !== "undefined"
            ? localStorage.getItem("token") || sessionStorage.getItem("token")
            : null;

    const res = await fetch(`${API_BASE}${path}`, {
        credentials: "include",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(options?.headers ?? {}),
        },
    });

    if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
    return res.json() as Promise<T>;
}

/**
 * Description: โครงสร้าง Envelope มาตรฐานที่ Backend ส่งกลับมา (ใช้ครอบข้อมูล response จริง)
 * Input : T (Generic type ของข้อมูลใน field data)
 * Output : ApiEnvelope<T>
 * Author : Nontapat Sinhum (Guitar) 66160104
 **/
type ApiEnvelope<T> = {
    success?: boolean;
    message?: string;
    data: T;
};

/**
 * Description: Payload สำหรับสร้าง Borrow Ticket จากรายการในตะกร้า
 * Input : cartItemId (number) = id ของ cart item ที่ต้องการสร้างคำร้อง
 * Output : CreateBorrowTicketPayload
 * Author : Nontapat Sinhum (Guitar) 66160104
 **/
export type CreateBorrowTicketPayload = {
    cartItemId: number;
};

export type DeleteCartItemPayload = {
    cartItemId: number;
};

/**
 * Description: Payload สำหรับการแก้ไขรายละเอียดในตะกร้า 
 * Input :  - borrower        : ชื่อผู้ยืม
 * - phone           : เบอร์โทรศัพท์ผู้ยืม
 * - reason          : เหตุผลในการยืม
 * - placeOfUse      : สถานที่ใช้งานอุปกรณ์
 * - quantity        : จำนวนอุปกรณ์ที่ต้องการยืม
 * - borrowDate      : วันที่เริ่มยืม (Date | ISO string | null)
 * - returnDate      : วันที่คืนอุปกรณ์ (Date | ISO string | null)
 * Output : UpdateCartItemPayload
 * Author : Salsabeela (San) 66160349
 **/
export type UpdateCartItemPayload = {
    borrower: string;
    phone: string;
    reason: string;
    placeOfUse: string;
    quantity: number;
    borrowDate: Date | string | null;
    returnDate: Date | string | null;
    deviceChilds: number[];
};

/**
 * Description: โครงสร้างข้อมูล Cart Item ที่ frontend ใช้หลังดึงจาก backend
 * Output : CartItem (type)
 * Author : Nontapat Sinhum (Guitar) 66160104
 **/
export type CartItem = {
    cti_id: number;
    cti_us_name: string;
    cti_phone: string;
    cti_note: string;
    cti_usage_location: string;
    cti_quantity: number;
    cti_start_date: string | null; // backend ส่ง ISO string
    cti_end_date: string | null;
    cti_ct_id: number | null;
    cti_dec_id: number | null;
    created_at?: string | null;
    updated_at?: string | null;

    device: Record<string, unknown> | null;
    de_ca_name: string | null;
    de_acc_name: string | null;
    de_dept_name: string | null;
    de_sec_name: string | null;

    dec_count: number;
    dec_ready_count: number;
    dec_availability: string; // "พร้อมใช้งาน" / "ไม่พร้อมใช้งาน"
    de_max_borrow_days: number;
    isBorrow: boolean;
};

/**
 * Description: โครงสร้างผลลัพธ์จาก API GET /borrow/cart/:id
 * Output : CartItemListResponse
 * Author : Nontapat Sinhum (Guitar) 66160104
 **/
export type CartItemListResponse = {
    itemData: CartItem[];
};

/**
 * Description: โครงสร้างผลลัพธ์จาก API DELETE /borrow/cart/:cti_id
 * Output : DeleteCartItemResponse
 * Author : Nontapat Sinhum (Guitar) 66160104
 **/
export type DeleteCartItemResponse = {
    message: string;
};

/**
 * Description: แจ้งระบบว่า cart มีการเปลี่ยนแปลง เพื่อให้ Navbar รีเช็ค badge แบบ realtime
 * Input : -
 * Output : void
 * Author : Nontapat Sinthum (Guitar) 66160104
 **/
function emitCartChanged(): void {
    window.dispatchEvent(new Event("cart:changed"));
}

export const CartService = {
    /**
    * Description: ดึงรายการอุปกรณ์ในตะกร้าของผู้ใช้ (backend จะ resolve ผู้ใช้จาก token/session)
    * Output : Promise<CartItemListResponse> = { itemData: CartItem[] }
    * Author : Nontapat Sinhum (Guitar) 66160104
    **/
    async getCartItems(): Promise<CartItemListResponse> {
        const res = await apiFetch<ApiEnvelope<CartItemListResponse>>(`/borrow/cart`);
        emitCartChanged();
        return res.data;
    },

    /**
    * Description: ลบรายการในตะกร้าตาม cartItemId
    * Input : payload: { cartItemId: number }
    * Output : Promise<string> = message ผลการลบ (ถ้าไม่มี message จะคืนค่า default)
    * Author : Nontapat Sinhum (Guitar) 66160104
    **/
    async deleteCartItem(payload: DeleteCartItemPayload): Promise<string> {
        const res = await apiFetch<ApiEnvelope<DeleteCartItemResponse>>(
            `/borrow/cart/`,
            { method: "DELETE", body: JSON.stringify(payload) },
        );
        emitCartChanged();
        return res.message ?? "Delete successfully";
    },

    /**
    * Description: สร้าง Borrow Ticket จากรายการในตะกร้า
    * Input : payload: { cartItemId: number }
    * Output : Promise<unknown> = ข้อมูลผลลัพธ์ที่ backend ส่งกลับ (ตามที่ backend กำหนด)
    * Author : Nontapat Sinhum (Guitar) 66160104
    **/
    async createBorrowTicket(
        payload: CreateBorrowTicketPayload
    ): Promise<unknown> {
        const res = await apiFetch<ApiEnvelope<unknown>>(
            `/borrow/cart/`,
            { method: "POST", body: JSON.stringify(payload) },
        );
        emitCartChanged();
        return res.data;
    },

    /**
   * UPDATE: แก้ไข cart item ตาม ctiId
   */
    /**
     * Description: แก้ไขรายละเอียดอุปกรณ์ในรถเข็น (Edit Cart)
     *
     * Note:
     * - ใช้ในหน้า Edit Cart
     * - รองรับการแก้ไขจำนวน, วันที่ยืม–คืน, ผู้ยืม, เหตุผล และสถานที่ใช้งาน
     *
     * Flow การทำงาน:
     * 1. รับ ctiId และข้อมูลที่แก้ไขจากฟอร์ม
     * 2. แปลง Date → ISO string ก่อนส่งไป Backend
     * 3. เรียก API PUT /borrow/cart/:ctiId
     * 4. Backend อัปเดตข้อมูลในระบบ
     *
     * Result:
     * - สำเร็จ → return message
     * - ไม่สำเร็จ → throw error ให้หน้า Edit Cart จัดการ
     *
     * Author: Salsabeela Sa-e (San) 66160349
     */
    async updateCartItem(
        ctiId: number,
        payload: UpdateCartItemPayload
    ): Promise<string> {
        try {
            const datapayload = {
                cti_us_name: payload.borrower,
                cti_phone: payload.phone,
                cti_note: payload.reason,
                cti_usage_location: payload.placeOfUse,
                cti_quantity: payload.quantity,
                cti_start_date: payload.borrowDate
                    ? new Date(payload.borrowDate).toISOString()
                    : null,
                cti_end_date: payload.returnDate
                    ? new Date(payload.returnDate).toISOString()
                    : null,
                device_childs: payload.deviceChilds,
            };

            const res = await apiFetch<ApiEnvelope<null>>(
                `/borrow/cart/device/${ctiId}`,
                { method: "PATCH", body: JSON.stringify(datapayload) },
            );
            emitCartChanged();
            return res.message ?? "Update successfully";
        } catch (error) {
            console.error("API UPDATE /borrow/cart error:", error);
            throw error;
        }
    },
};
export default CartService;
