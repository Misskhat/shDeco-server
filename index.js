const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.5bt6oyo.mongodb.net/?appName=Cluster0`;

// middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("shDeco server is running");
});

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection

    const db = client.db("shDeco");
    const servicesCollection = db.collection("services");
    const usersCollection = db.collection("users");
    const bookingsCollection = db.collection("bookings");

    //===================BOOKINGS ALL API'S ===================
    app.post("/bookings", async (req, res) => {
      const booking = req.body;
      if (
        !booking.userEmail ||
        !booking.serviceId ||
        !booking.bookingDate ||
        !booking.serviceLocation
      ) {
        return res.send({ message: "missing require fields" });
      }
      const newBooking = {
        userName: booking.userName,
        userEmail: booking.userEmail,

        serviceId: booking.serviceId,
        serviceTitle: booking.serviceTitle,
        serviceCategory: booking.serviceCategory,
        servicePrice: booking.servicePrice,

        bookingDate: booking.bookingDate,
        serviceLocation: booking.serviceLocation,
        serviceMode: booking.serviceMode,
        note: booking.note || "",

        status: "pending",
        paymentStatus: "unpaid",
        createdAt: new Date(),
      };
      const result = await bookingsCollection.insertOne(newBooking);
      res.send(result);
    });

    app.get("/bookings", async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await bookingsCollection.find(query).toArray();
      res.send(result);
    });

    //===================USER ALL API'S ===================

    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUserQuery = { email: user.email };
      const existingUser = await usersCollection.findOne(existingUserQuery);
      if (existingUser) {
        return res.send({ message: "User already exists", insertedId: null });
      }
      const result = await usersCollection.insertOne({
        ...user,
        role: "user",
        createdAt: new Date(),
      });
      res.send(result);
    });

    //===================SERVICES ALL API'S===================
    app.get("/services", async (req, res) => {
      const cursor = servicesCollection.find();
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/services/featured", async (req, res) => {
      const cursor = servicesCollection.find().limit(6);
      const result = await cursor.toArray();
      res.send(result);
    });

    app.get("/services/details/:id", async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await servicesCollection.findOne(query);
      res.send(result);
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
