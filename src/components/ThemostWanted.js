import dizajn1 from "../assets/img/dizajn1.png";
import dizajn2 from "../assets/img/dizajn2.png";
import dizajn3 from "../assets/img/dizajn3.png";
import dizajn4 from "../assets/img/dizajn4.png";
import Carousel from "react-multi-carousel";
import "react-multi-carousel/lib/styles.css";
import colorSharp from "../assets/img/color-sharp.png";

export const ThemostWanted = () => {
  const responsive = {
    superLargeDesktop: {
      // the naming can be any, depends on you.
      breakpoint: { max: 4000, min: 3000 },
      items: 5,
    },
    desktop: {
      breakpoint: { max: 3000, min: 1024 },
      items: 3,
    },
    tablet: {
      breakpoint: { max: 1024, min: 464 },
      items: 2,
    },
    mobile: {
      breakpoint: { max: 464, min: 0 },
      items: 1,
    },
  };

  return (
    <section className="skill" id="ThemostWanted">
      <div className="container">
        <div className="row">
          <div className="col-12">
            <div className="skill-bx wow zoomIn">
              <h2>The most Wanted </h2>

              <Carousel
                responsive={responsive}
                infinite={true}
                className="owl-carousel owl-theme skill-slider"
              >
                <div className="item">
                  <img src={dizajn1} alt="Image1" />
                </div>
                <div className="item">
                  <img src={dizajn2} alt="Image2" />
                </div>
                <div className="item">
                  <img src={dizajn3} alt="Image3" />
                </div>
                <div className="item">
                  <img src={dizajn4} alt="Image4" />
                </div>
              </Carousel>
            </div>
          </div>
        </div>
      </div>
      <img className="background-image-left" src={colorSharp} alt="Image2" />
    </section>
  );
};
