"use client";

import { useAccount, useReadContract } from 'wagmi';
import { CONTRACT_ADDRESSES } from '../contracts';
import { AgentRegistryABI } from '../contracts/abi/AgentRegistryABI';
import { erc20Abi } from 'viem';

export function useKiteData() {
  const { address } = useAccount();

  const { data: agents, isLoading: isLoadingAgents, refetch: refetchAgents } = useReadContract({
    address: CONTRACT_ADDRESSES.AgentRegistry as `0x${string}`,
    abi: AgentRegistryABI,
    functionName: 'getOwnerAgents',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    }
  });

  const { data: kttBalance, isLoading: isLoadingBalance } = useReadContract({
    address: CONTRACT_ADDRESSES.ERC20 as `0x${string}`,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: {
      enabled: !!address,
    }
  });

  const defaultMockAgents = [
    { id: '0x123', address: '0x123', name: 'Research Assistant', domain: 'research.kite.ai', status: 'Active', dailyLimit: '100 KTT', spentToday: '12.4 KTT' },
    { id: '0x456', address: '0x456', name: 'Trading Bot', domain: 'trading.kite.ai', status: 'Active', dailyLimit: '500 KTT', spentToday: '45.2 KTT' },
  ];

  const mockAgents = (agents as string[] || []).length > 0 
    ? (agents as string[]).map((addr, i) => ({
        id: addr,
        address: addr,
        name: `Agent ${i + 1}`,
        domain: `agent${i + 1}.kite.ai`,
        status: 'Active',
        dailyLimit: '100 KTT',
        spentToday: '12.4 KTT',
      }))
    : defaultMockAgents;

  return {
    address,
    agents: mockAgents,
    kttBalance: kttBalance || 0n,
    isLoading: isLoadingAgents || isLoadingBalance,
    refetchAgents,
  };
}
