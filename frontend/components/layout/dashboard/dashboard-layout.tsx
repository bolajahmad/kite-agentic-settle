"use client"

import {
  LayoutDashboard,
  Users,
  Wallet,
  ShoppingCart,
  History,
  Settings,
  HelpCircle,
  Menu,
  X,
  Bell,
  ShieldCheck,
  Zap,
  ChevronDown,
  RefreshCw,
  LogOut,
} from "lucide-react"
import { Menu as HeadlessMenu, MenuButton, MenuItem, MenuItems } from '@headlessui/react';
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { cn, truncateAddress } from "@/lib/utils"
import { OnboardingWizard } from "./onboarding-wizard"
import { useKiteData } from "@/utils/hooks/use-kite-data"
import { Button } from "@/components/ui/button"
import { injected, useAccount, useConnect, useDisconnect } from "wagmi"

const navItems = [
  { name: "Overview", href: "/", icon: LayoutDashboard },
  { name: "Agents", href: "/agents", icon: Users },
  { name: "Wallet", href: "/wallet", icon: Wallet },
  { name: "Marketplace", href: "/marketplace", icon: ShoppingCart },
  { name: "Channels", href: "/channels", icon: Zap },
  { name: "Audit Trail", href: "/audit", icon: ShieldCheck },
]

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const location = usePathname()
  const { address, agents, isLoading } = useKiteData()
  const { isConnected } = useAccount();
  const [showOnboarding, setShowOnboarding] = useState(
    !isLoading && address && agents.length === 0
  )
  const { connect, isPending: isConnecting } = useConnect()
  const { disconnect, isPending: isDisconnecting } = useDisconnect()

  if (showOnboarding) {
    return <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
  }

  return (
    <div className="bg-kite-bg text-kite-text min-h-screen font-sans">
      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "border-kite-border fixed inset-y-0 left-0 z-50 w-64 border-r bg-white transition-transform lg:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-3 p-8">
            <div className="bg-kite-primary shadow-kite-primary/20 flex h-10 w-10 items-center justify-center rounded-xl font-bold text-white shadow-lg">
              K
            </div>
            <span className="font-display text-kite-primary text-2xl font-bold tracking-tight">
              Kite Pay
            </span>
          </div>

          <nav className="flex-1 space-y-2 px-6">
            {navItems.map((item) => {
              const isActive = item.href === "/" ? location === item.href : location.includes(item.href)
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-200",
                    isActive
                      ? "bg-kite-primary shadow-kite-primary/10 text-white shadow-md"
                      : "hover:text-kite-primary hover:bg-kite-bg text-slate-500"
                  )}
                >
                  <item.icon size={20} />
                  <span className="font-medium">{item.name}</span>
                </Link>
              )
            })}
          </nav>

          <div className="border-kite-border space-y-2 border-t p-6">
            <Link
              href="/settings"
              className="hover:text-kite-primary hover:bg-kite-bg flex items-center gap-3 rounded-xl px-4 py-2 text-slate-500 transition-all"
            >
              <Settings size={20} />
              Settings
            </Link>
            <Link
              href="/help"
              className="hover:text-kite-primary hover:bg-kite-bg flex items-center gap-3 rounded-xl px-4 py-2 text-slate-500 transition-all"
            >
              <HelpCircle size={20} />
              Help & Docs
            </Link>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex min-h-screen flex-col lg:pl-64">
        {/* Header */}
        <header className="border-kite-border sticky top-0 z-30 flex h-20 items-center justify-between border-b bg-white/80 px-6 backdrop-blur-md lg:px-10">
          <button
            className="hover:text-kite-primary p-2 text-slate-500 lg:hidden"
            onClick={() => setIsSidebarOpen(true)}
          >
            <Menu size={24} />
          </button>

          <div className="flex-1" />

          <div className="flex items-center gap-6">
            <button className="hover:text-kite-primary relative p-2 text-slate-400 transition-colors">
              <Bell size={22} />
              <span className="bg-kite-accent absolute top-2 right-2 h-2.5 w-2.5 rounded-full border-2 border-white" />
            </button>
            <div className="bg-kite-border mx-2 h-8 w-px" />
            {isConnected ? (
              <HeadlessMenu as="div" className="relative">
                {({ open }) => (
                  <>
                    <MenuButton className="gap-2 rounded-xl" as="div">
                      <Button variant="secondary" size="sm">
                        <Wallet size={14} />
                        <span className="hidden sm:inline">
                          {truncateAddress(address ?? "")}
                        </span>
                        <ChevronDown
                          size={14}
                          className={cn(
                            "transition-transform",
                            open && "rotate-180"
                          )}
                        />
                      </Button>
                    </MenuButton>

                    <MenuItems className="absolute top-full right-0 z-100 mt-2 w-48 rounded-2xl border border-neutral-100 bg-white p-2 shadow-xl">
                      <MenuItem>
                        {({ focus }) => (
                          <button
                            onClick={() => connect({ connector: injected() })}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                              focus ? "bg-neutral-50" : ""
                            )}
                          >
                            <RefreshCw size={14} className="text-neutral-400" />
                            Switch Wallet
                          </button>
                        )}
                      </MenuItem>
                      <div className="my-1 h-px bg-neutral-50" />
                      <MenuItem>
                        {({ focus }) => (
                          <button
                            onClick={() => disconnect()}
                            className={cn(
                              "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-rose-600 transition-colors",
                              focus ? "bg-rose-50" : ""
                            )}
                          >
                            <LogOut size={14} />
                            Disconnect
                          </button>
                        )}
                      </MenuItem>
                    </MenuItems>
                  </>
                )}
              </HeadlessMenu>
            ) : (
              <Button
                onClick={() => connect({ connector: injected() })}
                variant="default"
                size="sm"
                className="gap-2 rounded-xl"
              >
                <Wallet size={14} />
                Connect Wallet
              </Button>
            )}
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 p-6 lg:p-12">
          {children}
        </main>
      </div>
    </div>
  )
}
