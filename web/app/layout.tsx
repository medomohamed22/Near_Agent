import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Arabic } from "next/font/google";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const arabic = Noto_Sans_Arabic({ variable: "--font-arabic", subsets: ["arabic"] });

export const metadata: Metadata = {
  title: "CarPass — used-car passport and safe sale on NEAR",
  description:
    "Service history with evidence, workshop-confirmed records, odometer conflict flags and an escrowed sale. A hackathon demo on NEAR testnet.",
};

export const viewport: Viewport = { themeColor: "#0b1220" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" dir="ltr" className={`${inter.variable} ${arabic.variable} antialiased`}>
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
