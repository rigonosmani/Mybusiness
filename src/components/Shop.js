import { Container, Row, Col, Tab, Nav } from "react-bootstrap";
import { ProjectCard } from "./ProjectCard";
import dizajn1 from "../assets/img/dizajn1.png";
import dizajn2 from "../assets/img/dizajn2.png";
import dizajn3 from "../assets/img/dizajn3.png";
import dizajn4 from "../assets/img/dizajn4.png";
import colorSharp2 from "../assets/img/color-sharp2.png";
import "animate.css";
import TrackVisibility from "react-on-screen";

export const Shop = () => {
  const Shop = [
    {
      title: "Get it Yours",
      OrderNow: "Add to card",
      imgUrl: dizajn1,
    },
    {
      title: "Get it Yours",
      OrderNow: "Add to card",
      imgUrl: dizajn2,
    },
    {
      title: "Get it Yours",
      OrderNow: "Add to card",
      imgUrl: dizajn3,
    },
    {
      title: "Get it Yours",
      OrderNow: "Add to card",
      imgUrl: dizajn2,
    },
    {
      title: "Get it Yours",
      OrderNow: "Add to card",
      imgUrl: dizajn1,
    },
    {
      title: "Get it Yours",
      OrderNow: "Add to card",
      imgUrl: dizajn4,
    },
  ];

  return (
    <section className="shop" id="shop">
      <Container>
        <Row>
          <Col size={12}>
            <TrackVisibility>
              {({ isVisible }) => (
                <div
                  className={
                    isVisible ? "animate__animated animate__fadeIn" : ""
                  }
                >
                  <h2>Shop</h2>
                  <span>YOU THINK WE REALIZE IT</span>
                  <Tab.Container id="Shop-tabs" defaultActiveKey="first">
                    <Nav
                      variant="pills"
                      className="nav-pills mb-5 justify-content-center align-items-center"
                      id="pills-tab"
                    >
                      <Nav.Item>
                        <Nav.Link eventKey="first">1</Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="second">2</Nav.Link>
                      </Nav.Item>
                      <Nav.Item>
                        <Nav.Link eventKey="third">3</Nav.Link>
                      </Nav.Item>
                    </Nav>
                    <Tab.Content
                      id="slideInUp"
                      className={
                        isVisible ? "animate__animated animate__slideInUp" : ""
                      }
                    >
                      <Tab.Pane eventKey="first">
                        <Row>
                          {Shop.map((shop, index) => {
                            return <ProjectCard key={index} {...shop} />;
                          })}
                        </Row>
                      </Tab.Pane>
                      <Tab.Pane eventKey="second">
                        <Row>
                          {Shop.map((shop, index) => {
                            return <ProjectCard key={index} {...shop} />;
                          })}
                        </Row>
                      </Tab.Pane>
                      <Tab.Pane eventKey="third">
                        <Row>
                          {Shop.map((shop, index) => {
                            return <ProjectCard key={index} {...shop} />;
                          })}
                        </Row>
                      </Tab.Pane>
                    </Tab.Content>
                  </Tab.Container>
                </div>
              )}
            </TrackVisibility>
          </Col>
        </Row>
      </Container>
      <img
        className="background-image-right"
        src={colorSharp2}
        alt="imgurl"
      ></img>
    </section>
  );
};
