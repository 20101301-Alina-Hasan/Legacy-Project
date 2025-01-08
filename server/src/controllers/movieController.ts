// @ts-nocheck
import { RequestHandler } from "express";
import { Request, Response } from "express";
import sequelize from "../models/sequelize";
import User from "../models/Users";
// import Movie from "../models/Movies";
// import Genre from "../models/Genre";
// import MovieGenre from "../models/MovieGenre";
// import MG from "../models/MovieGenre";
// import RR from "../models/Ratings&Reviews";
import db from "../models";
import { Op, Sequelize } from "sequelize";

const Movie = db.Movie;
const Genre = db.Genre;
const MG = db.MG;
const RR = db.RR;

export const createMovie: RequestHandler = async (
  req: Request,
  res: Response
) => {
  //console.log("api/movie: ", req.body);
  const {
    user_id,
    title,
    img,
    desc,
    release_yr,
    director,
    length,
    producer,
    genre,
  } = req.body;

  console.log("received req.body", req.body);
  try {
    const transaction = await sequelize.transaction();

    try {
      const movie = await Movie.create(
        { user_id, title, img, desc, release_yr, director, length, producer },
        { transaction }
      );

      console.log("sending", movie);

      // console.log("Created movie:", movie);
      // console.log("Movie ID:", movie.dataValues.movie_id);

      if (!movie.dataValues.movie_id) {
        throw new Error("Movie ID is null after creation");
      }

      const genreInstances = await Promise.all(
        genre.map(async (g: string) =>
          Genre.findOrCreate({ where: { genre: g }, transaction })
        )
      );

      // Prepare data for MovieGenre association
      const movieGenreAssociations = genreInstances.map(([genreInstance]) => ({
        movie_id: movie.dataValues.movie_id,
        genre_id: genreInstance.genre_id,
      }));

      // Bulk insert genre associations
      await MG.bulkCreate(movieGenreAssociations, { transaction });
      await transaction.commit();

      res.status(201).json({ message: "Movie created successfully", movie });
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  } catch (error) {
    console.error("Error during movie creation:", error);
    res.status(500).json({ error: "Failed to create movie" });
  }
};

export const getMovieById: RequestHandler = async (
  req: Request,
  res: Response
) => {
  try {
    const movie = await Movie.findByPk(req.params.id);
    console.log("movie", movie);
    if (!movie) {
      res.status(404).json({ error: "Movie not found" });
      return;
    }

    // Fetch all ratings for the movie
    const ratings = await RR.findAll({
      where: { movie_id: movie.dataValues.movie_id },
    });

    const user = await User.findOne({
      where: { user_id: movie.dataValues.user_id },
    });

    const averageRating =
      ratings.reduce((sum, item) => sum + item.dataValues.rating, 0) /
      (ratings.length || 1); // Avoid division by zero

    const genres = await MG.findAll({
      where: { movie_id: movie.dataValues.movie_id },
      include: [{ model: Genre, attributes: ["genre"] }],
    });

    const rr = await Promise.all(
      ratings.map(async (rating) => {
        const user = await User.findOne({
          where: { user_id: rating.dataValues.user_id },
        });
        return {
          rr_id: rating?.dataValues.rr_id,
          user_id: user?.dataValues.user_id,
          user: user?.dataValues.name,
          review: rating.dataValues.review,
          rating: rating.dataValues.rating,
        };
      })
    );

    res.status(200).json({
      ...movie.dataValues,
      rating: averageRating || null, // Handle no ratings gracefully
      genres: genres.map((x) => x.dataValues.Genre?.genre || "Unknown Genre"),
      user: user?.dataValues.name || "Unknown User", // Handle missing user gracefully
      rr,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch movie" });
  }
};

export const getMovieByUserId: RequestHandler = async (
  req: Request,
  res: Response
) => {
  try {
    const movies = await Movie.findAll({
      where: { user_id: req.params.id },
      attributes: {
        include: [
          // Add the average rating as a computed field
          [
            Sequelize.fn("AVG", Sequelize.col("ratingsReviews.rating")),
            "averageRating",
          ],
        ],
      },
      include: [
        {
          model: RR,
          as: "ratingsReviews", // Match the alias defined in the associations
          attributes: [], // Do not include all RR fields in the response
        },
        {
          model: Genre,
          as: "genres", // Match the alias for the many-to-many association
          attributes: ["genre"], // Include only the genre name
          through: { attributes: [] }, // Exclude junction table fields
        },
      ],
      group: ["Movie.movie_id", "genres.genre_id"], // Group by movie ID and genre ID
      order: [["movie_id", "DESC"]], // Sort by movie_id in ascending order
    });
    res.status(200).json(movies);
  } catch (error) {
    console.error("Error fetching movies with genres and ratings:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch movies with genres and ratings" });
  }
};

export const editMovie: RequestHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params; // Get movie ID from URL
    const updatedData = req.body; // Get new data from request body

    // Find the movie by ID
    const movie = await Movie.findByPk(id);

    if (!movie) {
      res.status(404).json({ error: "Movie not found" });
      return;
    }

    await movie.update(updatedData);

    res.status(200).json(movie);
  } catch (error) {
    console.error("Error updating movie:", error);
    res.status(500).json({ error: "Failed to update movie" });
  }
};

export const deleteMovie: RequestHandler = async (
  req: Request,
  res: Response
) => {
  try {
    const { id } = req.params; // Get movie ID from URL

    // Delete the movie by ID
    const movie = await Movie.destroy({
      where: {
        movie_id: id,
      },
    });

    const rr = await RR.destroy({
      where: {
        movie_id: id,
      },
    });

    const mg = await MG.destroy({
      where: {
        movie_id: id,
      },
    });

    res.status(200).json({ deleted: true });
  } catch (error) {
    console.error("Error deleting movie:", error);
    res.status(500).json({ error: "Failed to delete movie" });
  }
};

export const getAllMovies: RequestHandler = async (
  req: Request,
  res: Response
) => {
  try {
    const { title, genre } = req.query;

    // Define the base query options
    const queryOptions: any = {
      attributes: {
        include: [
          [
            Sequelize.fn("AVG", Sequelize.col("ratingsReviews.rating")),
            "averageRating", // Compute average rating
          ],
        ],
      },
      include: [
        {
          model: RR,
          as: "ratingsReviews",
          attributes: [], // Exclude individual review details
        },
        {
          model: Genre,
          as: "genres",
          attributes: ["genre"],
          through: { attributes: [] }, // Exclude junction table fields
        },
      ],
      group: ["Movie.movie_id", "genres.genre_id"], // Group by movie and genre
      order: [["movie_id", "DESC"]], // Sort by movie_id in descending order
    };

    // Add conditions based on query parameters
    if (title) {
      queryOptions.where = {
        ...queryOptions.where,
        title: {
          [Op.iLike]: `%${title}%`, // Partial match for title
        },
      };
    }

    if (genre) {
      queryOptions.include[1].where = { genre }; // Filter by genre
    }

    // Fetch movies based on query options
    const movies = await Movie.findAll(queryOptions);

    if (movies.length === 0) {
      res.status(404).json({ message: "No movies found" });
    } else {
      res.status(200).json(movies);
    }
  } catch (error) {
    console.error("Error searching for movies:", error);
    res.status(500).json({ error: "Failed to search for movies" });
  }
};
