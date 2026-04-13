import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const truncateString = (
  str: string,
  start: number = 6,
  end: number = 4
) => {
  if (!str) return ""
  if (str.length <= start + end) return str
  return `${str.slice(0, start)}...${str.slice(-end)}`
}

export const baseUrl =
  process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"
