import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "На связи — сообщения",
  description: "Отправка сообщений и проверка администратором.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className="antialiased">{children}</body>
    </html>
  );
}
