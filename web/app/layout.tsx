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

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f5fb" },
    { media: "(prefers-color-scheme: dark)", color: "#090b16" },
  ],
};

// Applies the saved theme and language before first paint, so the page never
// flashes the wrong one. Without a saved choice it stays light and English.
const boot = `try{var t=localStorage.getItem("carpass-theme"),l=localStorage.getItem("carpass-lang"),d=document.documentElement;if(t==="dark")d.dataset.theme="dark";if(l==="ar"){d.lang="ar";d.dir="rtl"}}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" dir="ltr" data-theme="light" className={`${inter.variable} ${arabic.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: boot }} />
      </head>
      <body className="min-h-screen">
        <div className="backdrop" aria-hidden><i /><i /><i /></div>
        {children}
      </body>
    </html>
  );
}
