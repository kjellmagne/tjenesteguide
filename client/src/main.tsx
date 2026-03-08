import React from "react";
import ReactDOM from "react-dom/client";
import { setGlobalTheme } from "@atlaskit/tokens";
import App from "./App";
import "./index.css";

void setGlobalTheme({
  light: "light",
  dark: "dark",
  colorMode: "light",
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

