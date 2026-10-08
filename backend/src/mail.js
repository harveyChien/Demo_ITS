import nodemailer from "nodemailer";
import "dotenv/config";

const mailUser = process.env.MAIL_USER?.trim();
const mailPassword = process.env.MAIL_PASSWORD?.replace(/\s/g, "");
const smtpConfigured = Boolean(mailUser && mailPassword);

function getSenderAddress() {
  const configuredFrom = process.env.MAIL_FROM?.trim();
  if (configuredFrom && !configuredFrom.includes("EMAIL_GMAIL_CUA_BAN")) {
    return configuredFrom;
  }
  return `ITS Smart Traffic <${mailUser}>`;
}

export const mailTransport = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.MAIL_HOST || "smtp.gmail.com",
      port: Number(process.env.MAIL_PORT || 465),
      secure: Number(process.env.MAIL_PORT || 465) === 465,
      auth: { user: mailUser, pass: mailPassword },
    })
  : null;

export async function sendActivationCode(email, code) {
  if (!mailTransport) {
    throw new Error("Chưa cấu hình Gmail SMTP trong backend/.env.");
  }

  try {
    await mailTransport.sendMail({
      from: getSenderAddress(),
      to: email,
      subject: "Mã kích hoạt tài khoản ITS Smart Traffic",
      text: `Mã kích hoạt của bạn là ${code}. Mã có hiệu lực trong 15 phút.`,
      html: `<p>Mã kích hoạt tài khoản ITS Smart Traffic:</p><h2>${code}</h2><p>Mã có hiệu lực trong 15 phút.</p>`,
    });
  } catch (error) {
    if (error?.responseCode === 535 || error?.code === "EAUTH") {
      throw new Error(
        "Gmail từ chối đăng nhập SMTP. MAIL_PASSWORD phải là App Password 16 ký tự của đúng MAIL_USER.",
      );
    }
    throw error;
  }
}
