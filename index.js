const express = require("express");
const app = express();
const cors = require("cors");
const Stripe = require("stripe");
require("dotenv").config();
const port = process.env.PORT || 3000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster0.5bt6oyo.mongodb.net/?appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

// Stripe setup
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// Middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("shDeco server is running");
});

async function run() {
  try {
    await client.connect();
    const db = client.db("shDeco");

    const servicesCollection = db.collection("services");
    const usersCollection = db.collection("users");
    const bookingsCollection = db.collection("bookings");
    const paymentsCollection = db.collection("payments");

    //=================== PAYMENT API ===================

    // Create Stripe Checkout session
    app.post("/create-checkout-session", async (req, res) => {
      const { cost, serviceTitle, bookingId, userEmail } = req.body;

      // Validation
      if (!cost || !serviceTitle || !bookingId || !userEmail) {
        return res.status(400).send({ error: "Missing required fields" });
      }

      const amount = parseFloat(cost);
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).send({ error: "Invalid amount" });
      }

      try {
        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: Math.round(amount * 100), // convert to cents
                product_data: { name: serviceTitle },
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: userEmail,
          success_url: `${process.env.CLIENT_URL}/dashboard/payments?success=true&bookingId=${bookingId}`,
          cancel_url: `${process.env.CLIENT_URL}/dashboard/payments?canceled=true`,
          metadata: { bookingId, userEmail },
        });

        res.send({ url: session.url });
      } catch (err) {
        console.error("Stripe checkout session failed:", err);
        res.status(500).send({ error: "Stripe checkout session failed" });
      }
    });

    // Webhook for Stripe payment confirmation
    app.post(
      "/webhook",
      express.raw({ type: "application/json" }),
      async (req, res) => {
        const sig = req.headers["stripe-signature"];
        let event;

        try {
          event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
          );
        } catch (err) {
          console.log("Webhook signature verification failed:", err.message);
          return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (event.type === "checkout.session.completed") {
          const session = event.data.object;
          const { bookingId, userEmail } = session.metadata;

          // Generate tracking ID
          const trackingId =
            "TRK-" + Math.random().toString(36).substring(2, 10).toUpperCase();

          // Save payment info
          await paymentsCollection.insertOne({
            bookingId,
            userEmail,
            paymentIntentId: session.payment_intent,
            amount: session.amount_total / 100,
            trackingId,
            status: "paid",
            createdAt: new Date(),
          });

          // Update booking payment status
          await bookingsCollection.updateOne(
            { _id: new ObjectId(bookingId) },
            { $set: { paymentStatus: "paid" } }
          );
        }

        res.json({ received: true });
      }
    );

    //=================== BOOKINGS API ===================
    app.post("/bookings", async (req, res) => {
      const booking = req.body;

      if (
        !booking.email ||
        !booking.serviceId ||
        !booking.bookingDate ||
        !booking.serviceLocation
      ) {
        return res.status(400).send({ message: "Missing required fields" });
      }

      const newBooking = {
        userName: booking.userName,
        email: booking.email,
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
      try {
        const { email, bookingId } = req.query;

        if (email) {
          const result = await bookingsCollection.find({ email }).toArray();
          return res.send(result);
        }

        if (bookingId) {
          // Validate ObjectId
          if (!ObjectId.isValid(bookingId)) {
            return res.status(400).send({ error: "Invalid booking ID" });
          }

          const result = await bookingsCollection
            .find({ _id: new ObjectId(bookingId) })
            .toArray();
          return res.send(result);
        }

        res.status(400).send({ error: "Missing query params" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ error: "Server error" });
      }
    });

    app.get("/admin/bookings", async (req, res) => {
      const result = await bookingsCollection.find().toArray();
      res.send(result);
    });

    app.patch("/admin/bookings/:id", async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const result = await bookingsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });

    //=================== USERS API ===================
    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser)
        return res.send({ message: "User already exists", insertedId: null });

      const result = await usersCollection.insertOne({
        ...user,
        role: "user",
        createdAt: new Date(),
      });

      res.send(result);
    });

    //=================== SERVICES API ===================
    app.get("/services", async (req, res) => {
      const services = await servicesCollection.find().toArray();
      res.send(services);
    });

    app.get("/services/featured", async (req, res) => {
      const services = await servicesCollection.find().limit(6).toArray();
      res.send(services);
    });

    app.get("/services/details/:id", async (req, res) => {
      const { id } = req.params;
      const service = await servicesCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(service);
    });

    await client.db("admin").command({ ping: 1 });
    console.log("Successfully connected to MongoDB!");
  } finally {
    // Do not close client to keep server running
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
