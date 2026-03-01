/**
 * Description: Utility function สำหรับสร้าง URL รูปภาพ
 * - รองรับ filename, blob, http URL
 * - คืน default-profile.png ถ้าไม่มี filename
 * Input : filename: string | null | undefined
 * Output : string (Full image URL)
 * Author: Pakkapon Chomchoey (Tonnam) 66160080
 */
const BASE_URL =
  process.env.NEXT_PUBLIC_IMAGE_URL ||
  (process.env.NEXT_PUBLIC_API_URL
    ? `${process.env.NEXT_PUBLIC_API_URL}/api/v1`
    : (process.env.NODE_ENV !== "production" ? "http://localhost:4041/api/v1" : "/api/v1"));

const getImageUrl = (filename: string | null | undefined) => {
  if (!filename || filename === "") {
    return "/default-profile.png";
  }
  if (
    (typeof filename === "string" && filename.startsWith("blob:")) ||
    filename.startsWith("http")
  )
    return filename;

  return `${BASE_URL}/${filename}`;
};

export default getImageUrl;
