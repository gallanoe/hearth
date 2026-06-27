import { createBrowserRouter } from "react-router"
import Layout from "@/components/Layout"
import HomePage from "@/pages/HomePage"
import AgentDetailPage from "@/pages/AgentDetailPage"
import SessionPage from "@/pages/SessionPage"

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "agents/:agentId", element: <AgentDetailPage /> },
      {
        path: "agents/:agentId/sessions/:sessionId",
        element: <SessionPage />,
      },
    ],
  },
])
