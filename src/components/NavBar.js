import { useState, useEffect } from "react";
import { Navbar, Nav, Container } from "react-bootstrap";
import navIcon3 from "../assets/img/nav-icon3.svg";
import cart from "../assets/img/cart.png";
import { BrowserRouter as Router } from "react-router-dom";

export const NavBar = () => {
  const [activeLink, setActiveLink] = useState("home");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      if (window.scrollY > 50) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }
    };

    window.addEventListener("scroll", onScroll);

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const onUpdateActiveLink = (value) => {
    setActiveLink(value);
  };

  return (
    <Router>
      <Navbar expand="md" className={scrolled ? "scrolled" : ""}>
        <Container>
          <h1>PR CASES</h1>
          <Navbar.Toggle aria-controls="basic-navbar-nav">
            <span className="navbar-toggler-icon"></span>
          </Navbar.Toggle>
          <Navbar.Collapse id="basic-navbar-nav">
            <Nav className="ms-auto">
              <Nav.Link
                href="#home"
                className={
                  activeLink === "home" ? "active navbar-link" : "navbar-link"
                }
                onClick={() => onUpdateActiveLink("home")}
              >
                Home
              </Nav.Link>
              <Nav.Link
                href="#ThemostWanted"
                className={
                  activeLink === "ThemostWanted"
                    ? "active navbar-link"
                    : "navbar-link"
                }
                onClick={() => onUpdateActiveLink("ThemostWanted")}
              >
                The most Wanted
              </Nav.Link>
              <Nav.Link
                href="#shop"
                className={
                  activeLink === "shop" ? "active navbar-link" : "navbar-link"
                }
                onClick={() => onUpdateActiveLink("shop")}
              >
                Shop
              </Nav.Link>
            </Nav>
            <span className="navbar-text">
              <a href="https://www.instagram.com/prishtinacases/">
                <button className="vvd">
                  <span>Costumize PhoneCases</span>
                </button>
              </a>
              <div className="social-icon">
                <a href="https://www.instagram.com/prishtinacases/">
                  <img src={navIcon3} alt="" />
                </a>
              </div>
              <div className="social-icon">
                <Nav.Link
                  href={cart}
                  className={
                    activeLink === "cart" ? "active navbar-link" : "navbar-link"
                  }
                  onClick={() => onUpdateActiveLink("cart")}
                >
                  <img src={cart} alt="" />
                </Nav.Link>
              </div>
            </span>
          </Navbar.Collapse>
        </Container>
      </Navbar>
    </Router>
  );
};
