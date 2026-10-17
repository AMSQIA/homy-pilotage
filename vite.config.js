import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Les ventes Shopify (shopify_extension.json, plusieurs Mo) sont embarquées sous forme de chaîne JSON : l'analyse est beaucoup
  // plus rapide qu'un littéral objet de cette taille et le fichier produit est plus petit.
  json: { stringify: true },
});
