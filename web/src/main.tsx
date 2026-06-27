import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "react-router"
import { router } from "./router"
// Self-hosted variable fonts: the machine (Geist) and the inhabitant (Newsreader).
import "@fontsource-variable/geist/index.css"
import "@fontsource-variable/geist-mono/index.css"
import "@fontsource-variable/newsreader/opsz.css"
import "@fontsource-variable/newsreader/opsz-italic.css"
import "./index.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
