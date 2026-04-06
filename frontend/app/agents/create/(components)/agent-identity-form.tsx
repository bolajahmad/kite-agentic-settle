import { Button } from "@/components/ui/button"
import {
  Field,
  FieldContent,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CONTRACT_ADDRESSES } from "@/utils/contracts"
import { AgentRegistryABI } from "@/utils/contracts/abi/AgentRegistryABI"
import { useGenerateAgent } from "@/utils/hooks/use-generate-agent"
import { AgentCreateModel, agentIdentitySchema } from "@/utils/schemas/agent"
import { zodResolver } from "@hookform/resolvers/zod"
import { Bot, ChevronRight, Loader2, Trash2 } from "lucide-react"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import { decodeEventLog, getAbiItem, stringToHex, toEventSelector } from "viem"
import { usePublicClient, useWriteContract } from "wagmi"

const CATEGORIES = [
  "Research",
  "Trading",
  "Social",
  "Development",
  "Personal Assistant",
  "Other",
]

const AGENT_SOURCES = [
  { id: "claude", name: "Claude (Anthropic)" },
  { id: "gpt", name: "GPT (OpenAI)" },
  { id: "openclaw", name: "OpenClaw" },
  { id: "custom", name: "Custom / Other" },
]

type Props = {
  onComplete: (agent?: AgentCreateModel) => void
  onError?: () => void
  info?: AgentCreateModel | null
}

export const AgentIdentity = ({ onComplete, onError, info }: Props) => {
  const form = useForm({
    resolver: zodResolver(agentIdentitySchema),
    defaultValues: info || {
      name: "",
      description: "",
      category: "",
      tags: [],
      source: "",
      agentAddress: "",
      domain: "",
    },
  })
  const { append, remove } = useFieldArray({
    control: form.control,
    name: "tags" as never,
  })
  const hasFormError = Object.keys(form.formState.errors).length > 0
  const { generateAgent, isGenerating } = useGenerateAgent()

  const pubClient = usePublicClient()
  const { writeContractAsync, isPending } = useWriteContract({
    mutation: {
      onError: (error) => {
        console.log({ error })
        onError?.()
      },
    },
  })

  const generateAgentWallet = async () => {
    const agents = await generateAgent(2, 1)
    if (agents.length > 0) {
      form.setValue("agentAddress", agents[0].address, {
        shouldDirty: true,
        shouldValidate: true,
      })
    }
  }

  const onSubmit = async (data: Record<string, string | string[]>) => {
    const metadata = {
      version: "0.1.0",
      name: data.name,
      description: data.description,
      category: data.category,
      tags: data.tags as string[],
      source: data.source,
      domain: data.domain,
    }
    const hexMetadata = stringToHex(JSON.stringify(metadata))

    const hash = await writeContractAsync({
      abi: AgentRegistryABI,
      address: CONTRACT_ADDRESSES.AgentRegistry,
      functionName: "registerAgent",
      args: [
        data.agentAddress as `0x${string}`,
        CONTRACT_ADDRESSES.KiteAAWallet,
        hexMetadata,
      ],
    })
    const arEvent = getAbiItem({
      abi: AgentRegistryABI,
      name: "AgentRegistered",
    })
    const topic = toEventSelector(arEvent)
    const receipt = await pubClient?.waitForTransactionReceipt({ hash })
    const log = receipt.logs.find(({ topics }) => topics[0] === topic)
    if (log) {
      const event = decodeEventLog({
        abi: AgentRegistryABI,
        data: log?.data,
        topics: log?.topics,
      })
      console.log({ event })
      onComplete({
        agentAddress: `${data.agentAddress}`,
        name: `${data.name}`,
        description: `${data.description}`,
        category: `${data.category}`,
        tags: data.tags as string[],
        source: `${data.source}`,
        domain: `${data.domain}`,
      })
    } else {
      onComplete(undefined)
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center gap-4">
        <div className="rounded-xl bg-kite-primary/10 p-3 text-kite-primary">
          <Bot size={24} />
        </div>
        <h2 className="font-display text-2xl font-bold text-kite-primary">
          Agent Identity
        </h2>
      </div>

      <form action="" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          <div className="space-y-2">
            <Controller
              control={form.control}
              name="name"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel
                    htmlFor="form-rhf-input-name"
                    className="text-xs font-bold tracking-widest text-slate-400 uppercase"
                  >
                    Agent Name
                  </FieldLabel>
                  <Input
                    {...field}
                    id="form-rhf-input-name"
                    className="w-full rounded-xl border border-kite-border bg-kite-bg px-5 py-3 font-medium transition-all outline-none focus:ring-2 focus:ring-kite-primary/20"
                    aria-invalid={fieldState.invalid}
                    placeholder="e.g. Research Assistant"
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
              name="category"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field
                  orientation="responsive"
                  data-invalid={fieldState.invalid}
                >
                  <FieldContent>
                    <FieldLabel>Category</FieldLabel>
                  </FieldContent>
                  <Select
                    name={field.name}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      id="form-rhf-select-chain"
                      aria-invalid={fieldState.invalid}
                      className="w-full"
                    >
                      <SelectValue placeholder="--- Select chain ---">
                        {field.value}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent position="item-aligned">
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Controller
              name="description"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="form-rhf-textarea-description">
                    Description
                  </FieldLabel>
                  <InputGroup>
                    <InputGroupTextarea
                      {...field}
                      id="form-rhf-textarea-description"
                      placeholder="What does this agent do?"
                      rows={5}
                      className="min-h-24 resize-none"
                      aria-invalid={fieldState.invalid}
                    />
                    <InputGroupAddon align="block-end">
                      <InputGroupText className="tabular-nums">
                        {field.value.length}/300 characters
                      </InputGroupText>
                    </InputGroupAddon>
                  </InputGroup>
                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Controller
              control={form.control}
              name="tags"
              render={({ field, fieldState }) => {
                return (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="form-rhf-input-tags">Tags</FieldLabel>

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
                      {field.value.map((id, index) => (
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

          <div className="space-y-2">
            <Controller
              name="source"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field
                  orientation="responsive"
                  data-invalid={fieldState.invalid}
                >
                  <FieldContent>
                    <FieldLabel className="text-xs font-bold tracking-widest text-slate-400 uppercase">
                      Agent Source
                    </FieldLabel>
                  </FieldContent>
                  <Select
                    name={field.name}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      id="form-rhf-select-agent-source"
                      aria-invalid={fieldState.invalid}
                      className="w-full"
                    >
                      <SelectValue
                        className="capitalize"
                        placeholder="--- Select chain ---"
                      >
                        {field.value.split("/")[1]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent position="item-aligned">
                      {AGENT_SOURCES.map((c) => (
                        <SelectItem key={c.id} value={`${c.id}/${c.name}`}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
              name="domain"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel
                    htmlFor="form-rhf-input-domain"
                    className="text-xs font-bold tracking-widest text-slate-400 uppercase"
                  >
                    Domain (Optional)
                  </FieldLabel>
                  <div className="relative">
                    <Input
                      {...field}
                      id="form-rhf-input-domain"
                      aria-invalid={fieldState.invalid}
                      placeholder="e.g. agent.kite.ai"
                    />
                  </div>

                  {fieldState.invalid && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Controller
              control={form.control}
              name="agentAddress"
              render={({ field, fieldState }) => {
                return (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="form-rhf-input-agent-address">
                      Agent Wallet Address
                    </FieldLabel>
                    <div className="flex gap-3">
                      <div className="relative flex-1">
                        <Input
                          {...field}
                          id="form-rhf-input-agent-address"
                          placeholder="0x..."
                          aria-invalid={fieldState.invalid}
                        />
                      </div>
                      <Button
                        onClick={() => generateAgentWallet()}
                        disabled={isGenerating}
                        type="button"
                        className="kite-button-secondary px-6 whitespace-nowrap"
                      >
                        {isGenerating ? (
                          <Loader2 className="animate-spin" />
                        ) : (
                          "Generate New"
                        )}
                      </Button>
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

        <div className="flex justify-end pt-10">
          <button
            type="submit"
            disabled={hasFormError || isPending}
            className="kite-button-primary px-10"
          >
            {isPending ? <Loader2 className="animate-spin" /> : null}
            Continue <ChevronRight size={18} />
          </button>
        </div>
      </form>
    </div>
  )
}
