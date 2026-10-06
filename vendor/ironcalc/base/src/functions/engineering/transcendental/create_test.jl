# Example file creating testing cases for BesselI

using Nemo

CC = AcbField(100)

values = [1, 2, 3, -2, 5, 30, 2e-8]

for value in values
    y_acb = besseli(CC(1), CC(value))
    real64 = convert(Float64, real(y_acb))
    im64 = convert(Float64, real(y_acb))
    println("(", value, ", ", real64, "),")
end