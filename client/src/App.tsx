import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout";
import TjenesteList from "./pages/TjenesteList";
import TjenesteForm from "./pages/TjenesteForm";
import AIChatPage from "./pages/AIChatPage";

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<TjenesteList />} />
          <Route path="/ai-chat" element={<AIChatPage />} />
          <Route path="/tjenester/ny" element={<TjenesteForm />} />
          <Route path="/tjenester/:id" element={<TjenesteForm />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;

