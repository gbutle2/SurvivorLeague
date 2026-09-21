import { installDom } from "./dom.ts";

// Side-effect import: ensure document exists before @testing-library loads.
installDom();
