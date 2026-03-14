'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Footer } from '@/components/layout/Footer';
import { Separator } from '@/components/ui/separator';
import Image from 'next/image';
import {
  Bot,
  MessageSquare,
  FileText,
  LogOut,
  Menu,
  X,
  Folder,
  Brain,
  Settings,
  BarChart2,
  Search,
  FlaskConical,
  Clock,
  Radio,
  Bell,
  Package,
} from 'lucide-react';

const NAV_ITEMS = [
  { href: '/dashboard/agents',        icon: Bot,          label: '🤖 Agents',        shortcut: 'g+a' },
  { href: '/dashboard/chat',          icon: MessageSquare, label: '💬 Chat',          shortcut: 'g+c' },
  { href: '/dashboard/search',        icon: Search,        label: '🔍 Search',        shortcut: 'g+s' },
  { href: '/dashboard/logs',          icon: FileText,      label: '📋 Logs',          shortcut: 'g+l' },
  { href: '/dashboard/monitor',       icon: Radio,         label: '📡 Monitor',       shortcut: 'g+o' },
  { href: '/dashboard/notifications', icon: Bell,          label: '🔔 Notifications', shortcut: 'g+b' },
  { href: '/dashboard/analytics',     icon: BarChart2,     label: '📊 Analytics',     shortcut: 'g+n' },
  { href: '/dashboard/playground',    icon: FlaskConical,  label: '🧪 Playground',    shortcut: 'g+p' },
  { href: '/dashboard/cron',          icon: Clock,         label: '⏰ Cron Jobs',     shortcut: 'g+r' },
  { href: '/dashboard/skills',        icon: Package,       label: '🧩 Skills',        shortcut: 'g+k' },
  { href: '/dashboard/workspace',     icon: Folder,        label: '📁 Workspace',     shortcut: 'g+w' },
  { href: '/dashboard/memory',        icon: Brain,         label: '🧠 Memory',        shortcut: 'g+m' },
  { href: '/dashboard/setup',         icon: Settings,      label: '⚙️ Setup',         shortcut: 'g+u' },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [username, setUsername] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Unauthorized');
        return res.json();
      })
      .then((data) => setUsername(data.username))
      .catch(() => router.push('/login'));
  }, [router]);

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  useEffect(() => {
    let gPressed = false;
    let gTimer: ReturnType<typeof setTimeout> | null = null;

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'g' || e.key === 'G') {
        gPressed = true;
        if (gTimer) clearTimeout(gTimer);
        gTimer = setTimeout(() => { gPressed = false; }, 1500);
        return;
      }

      if (gPressed) {
        const match = NAV_ITEMS.find(
          (item) => item.shortcut === `g+${e.key.toLowerCase()}`
        );
        if (match) {
          e.preventDefault();
          router.push(match.href);
          gPressed = false;
          if (gTimer) clearTimeout(gTimer);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    router.push('/login');
  };

  const Sidebar = ({ mobile = false }: { mobile?: boolean }) => (
    <div className={`flex flex-col h-full ${mobile ? 'p-4' : 'p-4'}`}>
      {/* Logo */}
      <div className="flex items-center gap-2 mb-6">
        <Image src="/logo.png" alt="ClawDeck" width={28} height={28} />
        <div>
          <span className="font-bold text-lg leading-none">ClawDeck</span>
          <span className="block text-[10px] text-muted-foreground font-mono leading-none mt-0.5">v1.8.0</span>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map(({ href, icon: Icon, label, shortcut }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setSidebarOpen(false)}
              title={`${label} (${shortcut})`}
              className={`group flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent'
              }`}
            >
              <Icon className="h-4 w-4 flex-shrink-0" />
              <span className="flex-1">{label}</span>
              <span className={`text-[9px] font-mono opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0 ${active ? 'text-primary-foreground/60' : 'text-muted-foreground'}`}>
                {shortcut}
              </span>
            </Link>
          );
        })}
      </nav>

      <Separator className="my-4" />

      {/* User + Logout */}
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground px-3">{username}</p>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground hover:text-foreground"
          onClick={handleLogout}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-56 flex-col border-r bg-card flex-shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setSidebarOpen(false)}
          />
          <aside className="relative w-56 h-full bg-card border-r flex flex-col">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2"
              onClick={() => setSidebarOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
            <Sidebar mobile />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden flex items-center gap-2 p-3 border-b bg-card">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Image src="/logo.png" alt="ClawDeck" width={20} height={20} />
          <span className="font-semibold text-sm flex-1">ClawDeck</span>
          <ThemeToggle />
        </header>

        {/* Desktop Header */}
        <header className="hidden md:flex items-center justify-end px-4 py-2 border-b bg-card">
          <span className="text-xs text-muted-foreground mr-auto pl-1 font-mono opacity-60">
            Press <kbd className="px-1 py-0.5 rounded bg-muted border text-[10px]">g</kbd> then a key to navigate
          </span>
          <ThemeToggle />
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-hidden">
          {children}
        </main>

        <Footer />
      </div>
    </div>
  );
}
