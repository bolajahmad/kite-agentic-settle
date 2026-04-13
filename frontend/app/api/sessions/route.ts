import { GET_ALL_SESSION_KEYS, graphqlClient } from "@/utils/queries"
import { hexToString } from "viem/utils"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = searchParams.get("page") || "1"
  const limit = searchParams.get("limit") || "20"
  const skip = (parseInt(page) - 1) * parseInt(limit)
  const aid = searchParams.get("aid") || "20"

  const variables: Record<string, string> = {}
  if (aid) variables["agentId"] = aid.toLowerCase()

  const data = await graphqlClient.request(GET_ALL_SESSION_KEYS, variables)
  const sessions = (data.sessionKeyAddeds || []).map(
    (s: Record<string, unknown>) => {
      const metadata = JSON.parse(hexToString(s.metadata as `0x${string}`))
      return {
        ...s,
        metadata,
      }
    }
  )

  return Response.json(sessions)
}
