"use client"

import { cn } from "@/lib/utils"
import { CONTRACT_ADDRESSES } from "@/utils/contracts"
import { KiteAAWalletABI } from "@/utils/contracts/abi/KiteAAWalletABI"
import { AgentCreateModel } from "@/utils/schemas/agent"
import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react"
import { AnimatePresence, motion } from "framer-motion"
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Coins,
  Key,
  Loader2,
  Shield,
  UserPlus,
  Zap,
} from "lucide-react"
import React, { useState } from "react"
import { toast } from "sonner"
import { zeroAddress } from "viem"
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi"
import { AgentIdentity } from "./agent-identity-form"
import { AgentSessionSetupForm, GenerateSessionKey } from "./agent-session-form"

const RegisterUserButton = ({
  onComplete,
  onError,
}: {
  onComplete: () => void
  onError?: () => void
}) => {
  const pubClient = usePublicClient()
  const { writeContract: registerUser, isPending } = useWriteContract({
    mutation: {
      onError: (error) => {
        console.log({ error })
        onError?.()
      },
      onSuccess: async (hash) => {
        await pubClient.waitForTransactionReceipt({ hash })
        toast.success("Wallet registered successfully!")
        onComplete()
      },
    },
  })

  return (
    <button
      onClick={() =>
        registerUser({
          abi: KiteAAWalletABI,
          address: CONTRACT_ADDRESSES.KiteAAWallet,
          functionName: "register",
        })
      }
      disabled={isPending}
      className="kite-button-primary px-10 py-4 text-lg shadow-xl shadow-kite-primary/20"
    >
      {isPending ? <Loader2 className="animate-spin" /> : <Zap size={20} />}
      Register Wallet
    </button>
  )
}

const AgentFundingSetup = ({
  rules,
  agent,
  handleNext,
}: {
  rules: { dailyLimit: string }
  agent: { name: string }
  handleNext: () => void
}) => {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [funding, setFunding] = useState({
    gasAmount: "0.1",
    stableAmount: "100",
  })

  const handleFinalize = async () => {
    setIsSubmitting(true)
    try {
      // Simulate funding transactions
      toast.loading("Depositing KITE for gas...", { id: "funding" })
      await new Promise((resolve) => setTimeout(resolve, 1500))

      toast.loading("Depositing KTT for operating capital...", {
        id: "funding",
      })
      await new Promise((resolve) => setTimeout(resolve, 1500))

      toast.success("Agent fully funded and registered!", { id: "funding" })
      handleNext()
    } catch (error) {
      toast.error("Funding failed.", { id: "funding" })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-kite-primary/10 p-3 text-kite-primary">
          <Coins size={24} />
        </div>
        <h2 className="font-display text-2xl font-bold text-kite-primary">
          Initial Funding
        </h2>
      </div>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-2">
        <div className="space-y-6">
          <div className="kite-card space-y-4 border-kite-border bg-kite-bg p-6">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-kite-primary">Gas Tank (KITE)</h4>
              <Zap size={18} className="text-kite-accent" />
            </div>
            <p className="text-xs text-slate-500">
              Funds used for transaction fees on the Kite L1.
            </p>
            <div className="space-y-2">
              <input
                type="number"
                className="w-full rounded-lg border border-kite-border bg-white px-4 py-2 font-mono outline-none focus:ring-2 focus:ring-kite-primary/20"
                value={funding.gasAmount}
                onChange={(e) =>
                  setFunding({
                    ...funding,
                    gasAmount: e.target.value,
                  })
                }
              />
              <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                Recommended: 0.1 KITE
              </p>
            </div>
          </div>

          <div className="kite-card space-y-4 border-kite-border bg-kite-bg p-6">
            <div className="flex items-center justify-between">
              <h4 className="font-bold text-kite-primary">
                Operating Capital (USDT)
              </h4>
              <Coins size={18} className="text-kite-primary" />
            </div>
            <p className="text-xs text-slate-500">
              Funds the agent will spend on API services.
            </p>
            <div className="space-y-2">
              <input
                type="number"
                className="w-full rounded-lg border border-kite-border bg-white px-4 py-2 font-mono outline-none focus:ring-2 focus:ring-kite-primary/20"
                value={funding.stableAmount}
                onChange={(e) =>
                  setFunding({
                    ...funding,
                    stableAmount: e.target.value,
                  })
                }
              />
              <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                Your Balance: 1,245 USDT
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-4 rounded-2xl border border-kite-primary/10 bg-kite-primary/5 p-6">
            <h4 className="font-bold text-kite-primary">Summary</h4>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Agent</span>
                <span className="font-bold">{agent.name}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Daily Limit</span>
                <span className="font-bold">{rules.dailyLimit} USDT</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Gas Deposit</span>
                <span className="font-bold">{funding.gasAmount} KITE</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Capital Deposit</span>
                <span className="font-bold">{funding.stableAmount} USDT</span>
              </div>
            </div>
            <div className="border-t border-kite-primary/10 pt-4">
              <div className="flex items-baseline justify-between">
                <span className="font-bold text-kite-primary">
                  Total Initial Funding
                </span>
                <span className="font-display text-xl font-bold text-kite-primary">
                  {funding.stableAmount} USDT
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={handleFinalize}
            disabled={isSubmitting}
            className="kite-button-primary w-full py-4 shadow-xl shadow-kite-primary/20"
          >
            {isSubmitting ? (
              <Loader2 className="animate-spin" />
            ) : (
              "Complete Onboarding"
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

export const STEPS = [
  { id: "user-reg", title: "User Registration", icon: UserPlus },
  { id: "agent-info", title: "Agent Information", icon: Bot },
  { id: "session-rules", title: "Session Rules", icon: Shield },
  { id: "session-key", title: "Session Key", icon: Key },
  { id: "funding", title: "Funding", icon: Coins },
]

export const RegisterAgentFormLayout = () => {
  const { address } = useAccount()
  const [currentStep, setCurrentStep] = React.useState(0)
  const [sessionKey, setSessionKey] = React.useState<{
    address: string
    privateKey: string
  } | null>(null)
  const [agent, setAgentInformation] = useState<AgentCreateModel | null>(null)

  const { data: isRegistered } = useReadContract({
    address: CONTRACT_ADDRESSES.KiteAAWallet,
    abi: KiteAAWalletABI,
    functionName: "isRegistered",
    args: [address ?? zeroAddress],
    query: {
      enabled: !!address,
    },
  })

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handlePrevious = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1)
    }
  }

  return (
    <TabGroup selectedIndex={currentStep} onChange={setCurrentStep}>
      <TabList className="flex items-center justify-between px-4">
        {STEPS.map((step, index) => (
          <Tab
            key={step.id}
            className="relative z-10 flex flex-col items-center gap-3 outline-none"
          >
            {({ selected }) => (
              <>
                <div
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-2xl border-2 transition-all duration-500",
                    selected
                      ? "scale-110 border-kite-primary bg-kite-primary text-white shadow-lg shadow-kite-primary/20"
                      : currentStep > index
                        ? "border-kite-primary/20 bg-kite-primary/10 text-kite-primary"
                        : "border-kite-border bg-white text-slate-300"
                  )}
                >
                  {currentStep > index ? (
                    <CheckCircle2 size={24} />
                  ) : (
                    <step.icon size={24} />
                  )}
                </div>
                <span
                  className={cn(
                    "text-[10px] font-bold tracking-widest uppercase transition-colors",
                    selected ? "text-kite-primary" : "text-slate-400"
                  )}
                >
                  {step.title}
                </span>

                {/* Connector Line */}
                {index < STEPS.length - 1 && (
                  <div className="absolute top-6 left-[calc(100%+1rem)] -z-10 h-0.5 w-[calc(100%-2rem)] bg-kite-border">
                    <motion.div
                      className="h-full bg-kite-primary"
                      initial={{ width: "0%" }}
                      animate={{ width: currentStep > index ? "100%" : "0%" }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                )}
              </>
            )}
          </Tab>
        ))}
      </TabList>

      {/* Step Content */}
      <div className="kite-card relative mt-6 min-h-125 overflow-hidden p-10">
        <TabPanels>
          <AnimatePresence mode="wait">
            <TabPanel key={0}>
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                {/* STEP 1: USER REGISTRATION */}
                <div className="space-y-8 py-10 text-center">
                  <motion.div
                    key={currentStep}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    transition={{ duration: 0.3 }}
                    className="space-y-8"
                  >
                    {/* STEP 1: USER REGISTRATION */}
                    <div className="space-y-8 py-10 text-center">
                      <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-3xl bg-kite-primary/10 text-kite-primary">
                        <UserPlus size={48} />
                      </div>
                      <div className="mx-auto max-w-md space-y-4">
                        <h2 className="font-display text-3xl font-bold text-kite-primary">
                          Connect & Register
                        </h2>
                        <p className="text-slate-500">
                          Before you can register agents, you need to register
                          your wallet as an owner in the Kite Agent Registry.
                        </p>
                      </div>

                      {isRegistered ? (
                        <div className="mx-auto flex max-w-md items-center gap-4 rounded-2xl border border-green-100 bg-green-50 p-6 text-green-700">
                          <CheckCircle2 size={24} />
                          <div className="text-left">
                            <p className="font-bold">Wallet Registered</p>
                            <p className="text-sm opacity-80">
                              Your wallet is already registered in the system.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <RegisterUserButton onComplete={() => handleNext()} />
                      )}

                      {isRegistered && (
                        <button
                          onClick={handleNext}
                          className="kite-button-primary px-10 py-4 text-lg shadow-xl shadow-kite-primary/20"
                        >
                          Continue to Agent Info <ArrowRight size={20} />
                        </button>
                      )}
                    </div>
                  </motion.div>
                </div>
              </motion.div>
            </TabPanel>

            <TabPanel key={1}>
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                {/* STEP 2: AGENT INFO */}
                <AgentIdentity
                  onComplete={(agent?: AgentCreateModel) => {
                    setAgentInformation(agent || null)
                    handleNext()
                  }}
                  info={agent}
                />
              </motion.div>
            </TabPanel>

            <TabPanel key={2}>
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                {/* STEP 3: SESSION RULES */}
                <div className="space-y-8">
                  <GenerateSessionKey
                    sessionKey={sessionKey}
                    handleBack={handlePrevious}
                    handleContinue={handleNext}
                    agentId="1"
                    updateSessionKey={(key) => setSessionKey(key)}
                  />
                </div>
              </motion.div>
            </TabPanel>

            <TabPanel key={3}>
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                {/* STEP 4: SESSION KEY */}
                <div className="space-y-8"></div>
                <AgentSessionSetupForm
                  handleBack={() => handlePrevious()}
                  sessionKey={sessionKey?.address ?? ""}
                  onComplete={() => handleNext()}
                />
              </motion.div>
            </TabPanel>

            <TabPanel key={4}>
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ duration: 0.3 }}
                className="space-y-8"
              >
                {/* STEP 5: FUNDING */}
                <AgentFundingSetup
                  handleNext={() =>
                    toast.success("Agent registration complete!")
                  }
                  rules={{ dailyLimit: "" }}
                  agent={{ name: "" }}
                />
              </motion.div>
            </TabPanel>
          </AnimatePresence>
        </TabPanels>
      </div>
    </TabGroup>
  )
}
