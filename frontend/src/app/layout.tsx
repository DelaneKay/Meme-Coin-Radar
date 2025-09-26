import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Toaster } from 'react-hot-toast';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Meme Coin Radar - Early Pump Detection & CEX Listing Alerts',
  description: 'Free-tier memecoin radar with early pump detection, security analysis, and real-time CEX listing alerts. Track buy/sell imbalance, volume surges, and price acceleration across multiple chains.',
  keywords: [
    'memecoin',
    'crypto radar',
    'early pump detection',
    'CEX listing alerts',
    'DeFi trading',
    'token analysis',
    'crypto signals',
    'blockchain monitoring'
  ],
  authors: [{ name: 'Meme Coin Radar Team' }],
  creator: 'Meme Coin Radar',
  publisher: 'Meme Coin Radar',
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://memecoinradar.com',
    title: 'Meme Coin Radar - Early Pump Detection & CEX Listing Alerts',
    description: 'Free-tier memecoin radar with early pump detection, security analysis, and real-time CEX listing alerts.',
    siteName: 'Meme Coin Radar',
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'Meme Coin Radar Dashboard',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Meme Coin Radar - Early Pump Detection & CEX Listing Alerts',
    description: 'Free-tier memecoin radar with early pump detection, security analysis, and real-time CEX listing alerts.',
    images: ['/og-image.png'],
    creator: '@memecoinradar',
  },
  viewport: {
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1,
  },
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f172a' },
  ],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="msapplication-TileColor" content="#0ea5e9" />
        <meta name="theme-color" content="#0ea5e9" />
      </head>
      <body className={`${inter.className} antialiased bg-gray-50 dark:bg-dark-900 text-gray-900 dark:text-gray-100`}>
        <Providers>
          <div className="min-h-screen">
            {children}
          </div>
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#1e293b',
                color: '#f1f5f9',
                border: '1px solid #334155',
              },
              success: {
                iconTheme: {
                  primary: '#22c55e',
                  secondary: '#f1f5f9',
                },
              },
              error: {
                iconTheme: {
                  primary: '#ef4444',
                  secondary: '#f1f5f9',
                },
              },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}