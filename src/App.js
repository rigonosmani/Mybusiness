import "./App.css";
import "bootstrap/dist/css/bootstrap.min.css";
import { NavBar } from "./components/NavBar";
import { Banner } from "./components/Banner";
import { ThemostWanted } from "./components/ThemostWanted";
import { Shop } from "./components/Shop";
import { Footer } from "./components/Footer";

function App() {
  return (
    <div className="App">
      <NavBar />
      <Banner />
      <ThemostWanted />
      <Shop />
      <Footer />
    </div>
  );
}

export default App;
