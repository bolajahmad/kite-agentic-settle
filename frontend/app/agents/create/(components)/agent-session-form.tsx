import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { CONTRACT_ADDRESSES } from "@/utils/contracts"
import { KiteAAWalletABI } from "@/utils/contracts/abi/KiteAAWalletABI"
import { useGenerateSession } from "@/utils/hooks/use-generate-agent"
import {
  AgentSessionCreateModel,
  agentSessionSchema,
} from "@/utils/schemas/agent"
import { zodResolver } from "@hookform/resolvers/zod"
import {
  AlertCircle,
  ChevronRight,
  Copy,
  Key,
  Loader2,
  Shield,
  Trash2,
  Zap,
} from "lucide-react"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import { toast } from "sonner"
import { parseUnits } from "viem"
import { usePublicClient, useWriteContract } from "wagmi"

export const GenerateSessionKey = ({
  updateSessionKey,
  sessionKey,
  handleBack,
  handleContinue,
  agentId,
}: {
  handleBack: () => void
  handleContinue: () => void
  sessionKey: { address: string } | null
  updateSessionKey: (key: { address: string }) => void
  agentId: string
}) => {
  const { generateSession, isGenerating } = useGenerateSession()

  const generateSessionKey = async () => {
    const sessions = await generateSession(parseInt(agentId), 1, 1)
    if (sessions.length > 0) {
      updateSessionKey({
        address: sessions[0].address,
      })
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-kite-primary/10 p-3 text-kite-primary">
          <Key size={24} />
        </div>
        <h2 className="font-display text-2xl font-bold text-kite-primary">
          Session Key Generation
        </h2>
      </div>

      <div className="mx-auto max-w-md space-y-8 py-6 text-center">
        <p className="text-slate-500">
          Generate an ephemeral session key that your agent will use to sign
          transactions. The private key will be shown only once.
        </p>

        {!sessionKey ? (
          <button
            onClick={generateSessionKey}
            className="kite-button-primary mx-auto px-10 py-4 shadow-xl shadow-kite-primary/20"
          >
            {isGenerating ? (
              <Loader2 className="animate-spin" />
            ) : (
              <Zap size={20} />
            )}{" "}
            Generate Session Key
          </button>
        ) : (
          <div className="space-y-6 text-left">
            <div className="space-y-4 rounded-2xl border border-kite-border bg-kite-bg p-6">
              <div className="space-y-1">
                <p className="text-[10px] font-bold tracking-widest text-slate-400 uppercase">
                  Public Address (On-chain)
                </p>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-lg break-all">
                    {sessionKey.address}
                  </code>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(sessionKey.address)
                      toast.success("Address copied!")
                    }}
                  >
                    <Copy size={14} className="text-slate-400" />
                  </button>
                </div>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-xl border border-amber-100 bg-amber-50 p-4 text-sm text-amber-700">
              <AlertCircle size={20} className="mt-0.5 shrink-0" />
              <p>
                Copy this private key now. You will need to provide it to your
                agent software. It cannot be recovered later.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex justify-between pt-10">
        <button onClick={handleBack} className="kite-button-secondary">
          Back
        </button>
        <button
          onClick={handleContinue}
          disabled={!sessionKey || isGenerating}
          className="kite-button-primary px-10"
        >
          Register Agent & Session <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

type Props = {
  onComplete: (model?: AgentSessionCreateModel & { address: string }) => void
  handleBack: () => void
  onError?: () => void
  sessionKey: string
  agentId?: string
}

export const AgentSessionSetupForm = ({
  onComplete,
  handleBack,
  onError,
  sessionKey,
  agentId,
}: Props) => {
  const form = useForm({
    resolver: zodResolver(agentSessionSchema),
    defaultValues: {
      valueLimit: "",
      dailyLimit: "",
      validUntil: "", // seconds
      blockedProviders: [] as string[],
      restrictedRecipients: [] as string[],
    },
  })
  const { append, remove } = useFieldArray({
    control: form.control,
    name: "blockedProviders" as never,
  })

  const pubClient = usePublicClient()
  const { writeContractAsync, isPending } = useWriteContract({
    mutation: {
      onError: (error) => {
        console.log({ error })
        onError?.()
      },
    },
  })

  const handleNext = () => {
    onComplete()
  }

  const onSubmit = async (data: AgentSessionCreateModel) => {
    if (!agentId) return
    console.log({ data })

    const hash = await writeContractAsync({
      abi: KiteAAWalletABI,
      address: CONTRACT_ADDRESSES.KiteAAWallet,
      functionName: "addSessionKeyRule",
      args: [
        sessionKey as `0x${string}`,
        agentId as `0x${string}`,
        parseUnits(`${data.valueLimit}`, 18),
        parseUnits(`${data.dailyLimit}`, 18),
        BigInt(new Date(Number(data.validUntil)).getTime() / 1000),
        data.blockedProviders as `0x${string}`[],
      ],
    })
    await pubClient?.waitForTransactionReceipt({ hash })
    onComplete({ ...data, address: sessionKey })
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-kite-primary/10 p-3 text-kite-primary">
          <Shield size={24} />
        </div>
        <h2 className="font-display text-2xl font-bold text-kite-primary">
          Spending Rules
        </h2>
      </div>

      <form className="space-y-8" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="space-y-2">
            <Controller
              control={form.control}
              name="valueLimit"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel
                    htmlFor="form-rhf-input-valueLimit"
                    className="text-xs font-bold tracking-widest text-slate-400 uppercase"
                  >
                    Max Per Transaction (USDT)
                  </FieldLabel>
                  <Input
                    {...field}
                    id="form-rhf-input-valueLimit"
                    type="number"
                    className="w-full rounded-xl border border-kite-border bg-kite-bg px-5 py-3 font-medium transition-all outline-none focus:ring-2 focus:ring-kite-primary/20"
                    aria-invalid={fieldState.invalid}
                    placeholder="Amount (in USDT)"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>
          <div className="space-y-2">
            <Controller
              control={form.control}
              name="dailyLimit"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel
                    htmlFor="form-rhf-input-dailyLimit"
                    className="text-xs font-bold tracking-widest text-slate-400 uppercase"
                  >
                    Daily Spending Limit (USDT)
                  </FieldLabel>
                  <Input
                    {...field}
                    type="number"
                    id="form-rhf-input-dailyLimit"
                    className="w-full rounded-xl border border-kite-border bg-kite-bg px-5 py-3 font-medium transition-all outline-none focus:ring-2 focus:ring-kite-primary/20"
                    aria-invalid={fieldState.invalid}
                    placeholder="Amount (in USDT)"
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>
          <div className="space-y-2">
            <Controller
              control={form.control}
              name="validUntil"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel
                    htmlFor="form-rhf-input-validUntil"
                    className="text-xs font-bold tracking-widest text-slate-400 uppercase"
                  >
                    Session Validity (Days)
                  </FieldLabel>
                  <Input
                    {...field}
                    id="form-rhf-input-validUntil"
                    type="datetime-local"
                    className="w-full rounded-xl border border-kite-border bg-kite-bg px-5 py-3 font-medium transition-all outline-none focus:ring-2 focus:ring-kite-primary/20"
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="space-y-4">
            <Controller
              control={form.control}
              name="blockedProviders"
              render={({ field, fieldState }) => {
                return (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="form-rhf-input-blocked">
                      {" "}
                      Blocked Providers (Blacklist)
                    </FieldLabel>

                    <div className="flex gap-3">
                      <Input
                        id="form-rhf-input-blocked"
                        placeholder="0x..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.currentTarget.value) {
                            e.preventDefault()
                            append(e.currentTarget.value)
                            e.currentTarget.value = ""
                          }
                        }}
                        aria-invalid={fieldState.invalid}
                        className="flex-1 rounded-xl border border-kite-border bg-kite-bg px-5 py-3 font-medium transition-all outline-none focus:ring-2 focus:ring-kite-primary/20"
                      />
                      <Button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget
                            .previousElementSibling as HTMLInputElement
                          if (input?.value) {
                            append(input.value)
                            input.value = ""
                          }
                        }}
                        className="kite-button-secondary rounded-md! px-6"
                      >
                        Add
                      </Button>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-2">
                      {field?.value?.map((id, index) => (
                        <span
                          key={id}
                          className="flex items-center gap-2 rounded-full bg-kite-primary/10 px-3 py-1 text-xs font-bold text-kite-primary"
                        >
                          {id}
                          <button type="button" onClick={() => remove(index)}>
                            <Trash2 size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )
              }}
            />
          </div>

          <div className="space-y-4">
            <Controller
              control={form.control}
              name="restrictedRecipients"
              render={({ field, fieldState }) => {
                return (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="form-rhf-input-tags">
                      {" "}
                      Restricted Recipients (Blacklist)
                    </FieldLabel>

                    <div className="flex gap-3">
                      <Input
                        id="form-rhf-input-tags"
                        placeholder="Add a tag..."
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && e.currentTarget.value) {
                            e.preventDefault()
                            append(e.currentTarget.value)
                            e.currentTarget.value = ""
                          }
                        }}
                        aria-invalid={fieldState.invalid}
                        className="flex-1 rounded-xl border border-kite-border bg-kite-bg px-5 py-3 font-medium transition-all outline-none focus:ring-2 focus:ring-kite-primary/20"
                      />
                      <Button
                        type="button"
                        onClick={(e) => {
                          const input = e.currentTarget
                            .previousElementSibling as HTMLInputElement
                          if (input?.value) {
                            append(input.value)
                            input.value = ""
                          }
                        }}
                        className="kite-button-secondary rounded-md! px-6"
                      >
                        Add
                      </Button>
                    </div>
                    <div className="mb-2 flex flex-wrap gap-2">
                      {field.value?.map((id, index) => (
                        <span
                          key={id}
                          className="flex items-center gap-2 rounded-full bg-kite-primary/10 px-3 py-1 text-xs font-bold text-kite-primary"
                        >
                          {id}
                          <button type="button" onClick={() => remove(index)}>
                            <Trash2 size={12} />
                          </button>
                        </span>
                      ))}
                    </div>
                    {fieldState.invalid && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )
              }}
            />
          </div>
        </div>

        <div className="flex justify-between pt-10">
          <button
            type="button"
            onClick={handleBack}
            className="kite-button-secondary"
          >
            Back
          </button>
          <button type="submit" className="kite-button-primary px-10">
            {isPending ? <Loader2 size={18} className="animate-spin" /> : null}
            Continue {isPending ? null : <ChevronRight size={18} />}
          </button>
        </div>
      </form>
    </div>
  )
}
