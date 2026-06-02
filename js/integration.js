
// AUTO INTEGRATION LAYER (non-breaking)
document.addEventListener("DOMContentLoaded", () => {
  console.log("Integration layer active");

  // Hook common buttons if exist
  document.querySelectorAll("[data-deposit]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const amount = parseFloat(prompt("Enter deposit amount"));
      if (!amount) return;

      await Transactions.create({
        type: "credit",
        category: "deposit",
        amount,
        method: "bank",
        note: "Auto deposit"
      });

      alert("Deposit recorded");
    });
  });

  document.querySelectorAll("[data-salary]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const amount = parseFloat(prompt("Salary amount"));
      if (!amount) return;

      await Transactions.create({
        type: "debit",
        category: "salary",
        amount,
        method: "cash",
        note: "Auto salary"
      });

      alert("Salary recorded");
    });
  });
});
