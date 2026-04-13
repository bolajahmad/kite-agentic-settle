import { baseUrl } from "@/lib/utils"
import { GET_ALL_EOA_AGENTS, graphqlClient } from "@/utils/queries"
import { hexToString } from "viem"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const page = searchParams.get("page") || "1"
  const limit = searchParams.get("limit") || "20"
  const skip = (parseInt(page) - 1) * parseInt(limit)
  const address = searchParams.get("owner") || "20"

  const variables: Record<string, string> = {}
  if (address) variables["owner"] = address.toLowerCase()

  const data = await graphqlClient.request(GET_ALL_EOA_AGENTS, variables)
  const agents = await (data.agentRegistereds || []).map(
    async (agent: Record<string, unknown>) => {
      // decode the metadata hex
      const metadata = JSON.parse(hexToString(agent.metadata as `0x${string}`))

      // fetch the agent's sessions
      const sessions = await fetch(
        `${baseUrl}/api/sessions?aid=${agent.agentId}`
      ).then((res) => res.json())

      return {
        ...agent,
        timeStamp: agent.timestamp_ as string,
        transactionHash: agent.transactionHash_ as string,
        metadata,
        sessions,
      }
    }
  )
  console.log({ agents })

  return Response.json(await Promise.all(agents))
}
