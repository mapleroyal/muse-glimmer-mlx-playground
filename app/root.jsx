import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import { ThemeSync } from "@/components/theme-sync";
import { Toaster } from "@/components/ui/sonner";
import { APP_DESCRIPTION, APP_NAME, formatPageTitle } from "@/lib/app-config";

import "./globals.css";

export function meta() {
  return [{ title: formatPageTitle() }];
}

export function HydrateFallback() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-4xl items-center justify-center p-6 text-muted-foreground">
      Starting Muse Glimmer…
    </div>
  );
}

export function Layout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="application-name" content={APP_NAME} />
        <meta name="apple-mobile-web-app-title" content={APP_NAME} />
        <meta name="description" content={APP_DESCRIPTION} />
        <meta
          name="theme-color"
          content="#ffffff"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#171717"
          media="(prefers-color-scheme: dark)"
        />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <ThemeSync />
        {children}
        <Toaster position="top-center" />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
