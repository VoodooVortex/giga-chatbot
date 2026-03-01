import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || "/api/v1", // backend port
  withCredentials: true, // ถ้าใช้ cookie auth
});

api.interceptors.request.use(
  (config) => {
    // 1. ดึง Token ที่คุณเก็บไว้ (เช่น ใน localStorage)
    const token = localStorage.getItem("token") ||
      sessionStorage.getItem("token"); // <-- เปลี่ยน "accessToken" เป็น key ที่คุณใช้

    // 2. ถ้ามี Token, ให้แนบไปใน Header
    if (token) {
      config.headers["Authorization"] = `Bearer ${token}`;
    }

    // 3. ส่ง Request ที่มี Header แล้ว ออกไป
    return config;
  },
  (error) => {
    return Promise.reject(error);
  },
);

export default api;
