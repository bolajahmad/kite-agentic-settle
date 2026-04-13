"use client"

import { useQuery } from "@tanstack/react-query"
import { useAccount } from "wagmi"
import { IAgent } from "../queries/models"

export function useKiteData() {
  const { address } = useAccount()

  const { data, isLoading, refetch } = useQuery<IAgent[]>({
    queryKey: ["agents-by-eoa", address],
    queryFn: () =>
      fetch(`/api/agents?owner=${address}`).then((res) => res.json()),
    enabled: !!address,
  })
  const agents = data || []

  return {
    address,
    agents,
    isLoading,
    refetchAgents: refetch,
  }
}
