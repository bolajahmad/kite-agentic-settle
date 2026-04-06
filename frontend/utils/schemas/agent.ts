import z from "zod"

export type AgentCreateModel = {
  name: string
  description: string
  category: string
  tags: string[]
  source: string
  agentAddress: string
  domain?: string
  agentId?: string
}

export const agentIdentitySchema = z.object({
  name: z
    .string()
    .min(1, "Agent name is required")
    .max(100, "Agent name must be less than 100 characters"),
  description: z
    .string()
    .min(1, "Description is required")
    .max(1000, "Description must be less than 1000 characters"),
  category: z.string().min(1, "Category is required"),
  tags: z.array(z.string()).min(0, "Tags must be an array"),
  source: z.string().min(1, "Source is required"),
  agentAddress: z.string().min(1, "Agent address is required"),
  domain: z.string().optional(),
})

export const agentSessionSchema = z
  .object({
    valueLimit: z
      .string()
      .min(1, "Value limit is required")
      .refine(
        (val) => !isNaN(Number(val)) && Number(val) > 0,
        "Value limit must be a positive number"
      ),
    dailyLimit: z
      .string()
      .min(1, "Daily limit is required")
      .refine(
        (val) => !isNaN(Number(val)) && Number(val) > 0,
        "Daily limit must be a positive number"
      ),
    validUntil: z
      .string()
      .min(1, "Session validity is required")
      .refine(
        (val) => !isNaN(Number(val)) && Number(val) > 0,
        "Session validity must be a positive number"
      ),
    allowedRecipients: z.array(z.string()).optional(),
    restrictedRecipients: z.array(z.string()).optional(),
  })
  .refine((data) => Number(data.valueLimit) <= Number(data.dailyLimit), {
    message: "Value limit must not exceed daily limit",
    path: ["valueLimit"],
  })
