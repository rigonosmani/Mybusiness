import { Col } from "react-bootstrap";

export const ProjectCard = ({ title, description, imgUrl, OrderNow }) => {
  return (
    <Col size={12} sm={6} md={4}>
      <div className="proj-imgbx">
        <img src={imgUrl} alt="imgurl" />
        <div className="proj-txtx">
          <h4>{title}</h4>
          <span>{description}</span>

          <a href="#cart">
            <h1 className="navbar-text">
              <a href="https://www.instagram.com/prishtinacases/">
                <button className="vvd">
                  <span>Order Now</span>
                </button>
              </a>
            </h1>
          </a>
        </div>
      </div>
    </Col>
  );
};
