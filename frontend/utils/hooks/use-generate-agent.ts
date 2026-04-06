import { entropyToMnemonic } from "@scure/bip39"
import { wordlist } from "@scure/bip39/wordlists/english.js"
import { useState } from "react"
import { keccak256, toBytes } from "viem"
import { type HDAccount, mnemonicToAccount } from "viem/accounts"
import { useSignMessage } from "wagmi"

export function useGenerateAgent() {
  const { signMessageAsync, isPending } = useSignMessage()
  const [agents, setAgents] = useState<HDAccount[]>([])

  const generateAgent = async (startFrom: number, count = 1) => {
    const signature = await signMessageAsync({
      message: "Sign this to unlock your AI Agents. This does not cost gas.",
    })
    const entropy = keccak256(signature)
    const mnemonic = entropyToMnemonic(toBytes(entropy).slice(0, 16), wordlist)

    const newAgents = Array.from({ length: count }).map(() => {
      return mnemonicToAccount(mnemonic, {
        path: `m/44'/60'/0'/${startFrom++}/0`,
      })
    })
    setAgents(newAgents)
    return newAgents
  }

  return {
    agents,
    generateAgent,
    isGenerating: isPending,
  }
}

export function useGenerateSession() {
  const { signMessageAsync, isPending } = useSignMessage()
  const [sessions, setSessions] = useState<HDAccount[]>([])

  const generateSession = async (
    agentId: number,
    startFrom: number,
    count = 1
  ) => {
    const signature = await signMessageAsync({
      message: "Sign this to generate a new Session. This does not cost gas.",
    })
    const entropy = keccak256(signature)
    const mnemonic = entropyToMnemonic(toBytes(entropy).slice(0, 16), wordlist)

    const sess = Array.from({ length: count }).map(() => {
      return mnemonicToAccount(mnemonic, {
        path: `m/44'/60'/0'/${agentId}/${startFrom++}`,
      })
    })
    setSessions(sess)
    return sess
  }

  return {
    sessions,
    generateSession,
    isGenerating: isPending,
  }
}
