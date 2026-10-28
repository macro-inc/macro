#![allow(clippy::unwrap_used)]

use crate::test::util::new_empty_model;

// ── BETADIST ─────────────────────────────────────────────────────────────────

#[test]
fn test_betadist() {
    let mut model = new_empty_model();
    // BETADIST(x, alpha, beta) — always cumulative, A=0, B=1
    model._set("A1", "=BETADIST(0.5, 2, 2)");
    // BETADIST(x, alpha, beta, A, B)
    model._set("A2", "=BETADIST(0.5, 2, 2, 0, 1)");
    // Wrong arg count
    model._set("A3", "=BETADIST()");
    model._set("A4", "=BETADIST(0.5, 2, 2, 0, 1, 99)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.5");
    assert_eq!(model._get_text("A2"), *"0.5");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

// ── BETAINV ──────────────────────────────────────────────────────────────────

#[test]
fn test_betainv() {
    let mut model = new_empty_model();
    model._set("A1", "=BETAINV(0.5, 2, 2)");
    model._set("A2", "=BETAINV()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.5");
    assert_eq!(model._get_text("A2"), *"#ERROR!");
}

// ── BINOMDIST ────────────────────────────────────────────────────────────────

#[test]
fn test_binomdist() {
    let mut model = new_empty_model();
    model._set("A1", "=BINOMDIST(2, 5, 0.5, TRUE)");
    model._set("A2", "=BINOMDIST(2, 5, 0.5, FALSE)");
    model._set("A3", "=BINOMDIST()");
    model._set("A4", "=BINOMDIST(2, 5, 0.5, TRUE, 99)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.5");
    assert_eq!(model._get_text("A2"), *"0.3125");
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

// ── CHIDIST ──────────────────────────────────────────────────────────────────

#[test]
fn test_chidist() {
    let mut model = new_empty_model();
    // CHIDIST(x, deg_freedom) = CHISQ.DIST.RT(x, deg_freedom)
    model._set("A1", "=CHIDIST(3.5, 4)");
    model._set("A2", "=CHISQ.DIST.RT(3.5, 4)");
    model._set("A3", "=CHIDIST()");
    model._set("A4", "=CHIDIST(3.5, 4, 1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

// ── CHIINV ───────────────────────────────────────────────────────────────────

#[test]
fn test_chiinv() {
    let mut model = new_empty_model();
    // CHIINV(prob, deg_freedom) = CHISQ.INV.RT(prob, deg_freedom)
    model._set("A1", "=CHIINV(0.05, 4)");
    model._set("A2", "=CHISQ.INV.RT(0.05, 4)");
    model._set("A3", "=CHIINV()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── CHITEST ──────────────────────────────────────────────────────────────────

#[test]
fn test_chitest() {
    let mut model = new_empty_model();
    model._set("A1", "48");
    model._set("A2", "32");
    model._set("A3", "12");
    model._set("B1", "55");
    model._set("B2", "34");
    model._set("B3", "13");
    // CHITEST = CHISQ.TEST
    model._set("C1", "=CHITEST(A1:A3, B1:B3)");
    model._set("C2", "=CHISQ.TEST(A1:A3, B1:B3)");
    model._set("C3", "=CHITEST()");
    model.evaluate();
    assert_eq!(model._get_text("C1"), model._get_text("C2"));
    assert_eq!(model._get_text("C3"), *"#ERROR!");
}

// ── CONFIDENCE ───────────────────────────────────────────────────────────────

#[test]
fn test_confidence() {
    let mut model = new_empty_model();
    // CONFIDENCE(alpha, sigma, n) = CONFIDENCE.NORM(alpha, sigma, n)
    model._set("A1", "=CONFIDENCE(0.05, 2, 100)");
    model._set("A2", "=CONFIDENCE.NORM(0.05, 2, 100)");
    model._set("A3", "=CONFIDENCE()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── COVAR ────────────────────────────────────────────────────────────────────

#[test]
fn test_covar() {
    let mut model = new_empty_model();
    model._set("A1", "3");
    model._set("A2", "9");
    model._set("A3", "2");
    model._set("B1", "5");
    model._set("B2", "15");
    model._set("B3", "6");
    // COVAR = COVARIANCE.P
    model._set("C1", "=COVAR(A1:A3, B1:B3)");
    model._set("C2", "=COVARIANCE.P(A1:A3, B1:B3)");
    model._set("C3", "=COVAR()");
    model.evaluate();
    assert_eq!(model._get_text("C1"), model._get_text("C2"));
    assert_eq!(model._get_text("C3"), *"#ERROR!");
}

// ── CRITBINOM ────────────────────────────────────────────────────────────────

#[test]
fn test_critbinom() {
    let mut model = new_empty_model();
    // CRITBINOM(trials, probability_s, alpha) = BINOM.INV(trials, probability_s, alpha)
    model._set("A1", "=CRITBINOM(6, 0.5, 0.75)");
    model._set("A2", "=BINOM.INV(6, 0.5, 0.75)");
    model._set("A3", "=CRITBINOM()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── EXPONDIST ────────────────────────────────────────────────────────────────

#[test]
fn test_expondist() {
    let mut model = new_empty_model();
    model._set("A1", "=EXPONDIST(1, 1, TRUE)");
    model._set("A2", "=EXPON.DIST(1, 1, TRUE)");
    model._set("A3", "=EXPONDIST()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── FDIST ────────────────────────────────────────────────────────────────────

#[test]
fn test_fdist() {
    let mut model = new_empty_model();
    // FDIST(x, df1, df2) = F.DIST.RT(x, df1, df2)
    model._set("A1", "=FDIST(3, 4, 5)");
    model._set("A2", "=F.DIST.RT(3, 4, 5)");
    model._set("A3", "=FDIST()");
    model._set("A4", "=FDIST(3, 4, 5, 1)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

// ── FINV ─────────────────────────────────────────────────────────────────────

#[test]
fn test_finv() {
    let mut model = new_empty_model();
    // FINV(prob, df1, df2) = F.INV.RT(prob, df1, df2)
    model._set("A1", "=FINV(0.1, 4, 5)");
    model._set("A2", "=F.INV.RT(0.1, 4, 5)");
    model._set("A3", "=FINV()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── FTEST ────────────────────────────────────────────────────────────────────

#[test]
fn test_ftest() {
    let mut model = new_empty_model();
    model._set("A1", "6");
    model._set("A2", "7");
    model._set("A3", "9");
    model._set("B1", "2");
    model._set("B2", "4");
    model._set("B3", "5");
    // FTEST = F.TEST
    model._set("C1", "=FTEST(A1:A3, B1:B3)");
    model._set("C2", "=F.TEST(A1:A3, B1:B3)");
    model._set("C3", "=FTEST()");
    model.evaluate();
    assert_eq!(model._get_text("C1"), model._get_text("C2"));
    assert_eq!(model._get_text("C3"), *"#ERROR!");
}

// ── GAMMADIST ────────────────────────────────────────────────────────────────

#[test]
fn test_gammadist() {
    let mut model = new_empty_model();
    model._set("A1", "=GAMMADIST(5, 2, 2, TRUE)");
    model._set("A2", "=GAMMA.DIST(5, 2, 2, TRUE)");
    model._set("A3", "=GAMMADIST()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── GAMMAINV ─────────────────────────────────────────────────────────────────

#[test]
fn test_gammainv() {
    let mut model = new_empty_model();
    model._set("A1", "=GAMMAINV(0.5, 2, 2)");
    model._set("A2", "=GAMMA.INV(0.5, 2, 2)");
    model._set("A3", "=GAMMAINV()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── HYPGEOMDIST ──────────────────────────────────────────────────────────────

#[test]
fn test_hypgeomdist() {
    let mut model = new_empty_model();
    // HYPGEOMDIST(sample_s, number_sample, population_s, number_pop)
    // = HYPGEOM.DIST(sample_s, number_sample, population_s, number_pop, FALSE)
    model._set("A1", "=HYPGEOMDIST(1, 4, 2, 8)");
    model._set("A2", "=HYPGEOM.DIST(1, 4, 2, 8, FALSE)");
    model._set("A3", "=HYPGEOMDIST()");
    model._set("A4", "=HYPGEOMDIST(1, 4, 2, 8, FALSE)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

// ── LOGINV ───────────────────────────────────────────────────────────────────

#[test]
fn test_loginv() {
    let mut model = new_empty_model();
    // LOGINV(prob, mean, standard_dev) = LOGNORM.INV(prob, mean, standard_dev)
    // LOGINV(0.5, 0, 1) = 1 (median of log-normal with mu=0, sigma=1)
    model._set("A1", "=LOGINV(0.5, 0, 1)");
    model._set("A2", "=LOGNORM.INV(0.5, 0, 1)");
    model._set("A3", "=LOGINV()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"1");
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── LOGNORMDIST ──────────────────────────────────────────────────────────────

#[test]
fn test_lognormdist() {
    let mut model = new_empty_model();
    // LOGNORMDIST(x, mean, standard_dev) = LOGNORM.DIST(x, mean, standard_dev, TRUE)
    model._set("A1", "=LOGNORMDIST(1, 0, 1)");
    model._set("A2", "=LOGNORM.DIST(1, 0, 1, TRUE)");
    model._set("A3", "=LOGNORMDIST()");
    model._set("A4", "=LOGNORMDIST(1, 0, 1, TRUE)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.5");
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

// ── MODE ─────────────────────────────────────────────────────────────────────

#[test]
fn test_mode() {
    let mut model = new_empty_model();
    model._set("A1", "=MODE(1, 2, 2, 3)");
    model._set("A2", "=MODE.SNGL(1, 2, 2, 3)");
    model._set("A3", "=MODE()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"2");
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── NEGBINOMDIST ─────────────────────────────────────────────────────────────

#[test]
fn test_negbinomdist() {
    let mut model = new_empty_model();
    // NEGBINOMDIST(number_f, number_s, probability_s)
    // = NEGBINOM.DIST(number_f, number_s, probability_s, FALSE)
    model._set("A1", "=NEGBINOMDIST(2, 5, 0.5)");
    model._set("A2", "=NEGBINOM.DIST(2, 5, 0.5, FALSE)");
    model._set("A3", "=NEGBINOMDIST()");
    model._set("A4", "=NEGBINOMDIST(2, 5, 0.5, FALSE)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

// ── NORMDIST ─────────────────────────────────────────────────────────────────

#[test]
fn test_normdist() {
    let mut model = new_empty_model();
    model._set("A1", "=NORMDIST(0, 0, 1, TRUE)");
    model._set("A2", "=NORM.DIST(0, 0, 1, TRUE)");
    model._set("A3", "=NORMDIST()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.5");
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── NORMINV ──────────────────────────────────────────────────────────────────

#[test]
fn test_norminv() {
    let mut model = new_empty_model();
    model._set("A1", "=NORMINV(0.5, 0, 1)");
    model._set("A2", "=NORM.INV(0.5, 0, 1)");
    model._set("A3", "=NORMINV()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0");
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── NORMSDIST ────────────────────────────────────────────────────────────────

#[test]
fn test_normsdist() {
    let mut model = new_empty_model();
    // NORMSDIST(z) = NORM.S.DIST(z, TRUE) — always cumulative, 1 arg
    model._set("A1", "=NORMSDIST(0)");
    model._set("A2", "=NORM.S.DIST(0, TRUE)");
    model._set("A3", "=NORMSDIST()");
    model._set("A4", "=NORMSDIST(0, TRUE)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0.5");
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
    assert_eq!(model._get_text("A4"), *"#ERROR!");
}

// ── NORMSINV ─────────────────────────────────────────────────────────────────

#[test]
fn test_normsinv() {
    let mut model = new_empty_model();
    model._set("A1", "=NORMSINV(0.5)");
    model._set("A2", "=NORM.S.INV(0.5)");
    model._set("A3", "=NORMSINV()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), *"0");
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── PERCENTILE ───────────────────────────────────────────────────────────────

#[test]
fn test_percentile() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    // PERCENTILE = PERCENTILE.INC
    model._set("B1", "=PERCENTILE(A1:A5, 0.5)");
    model._set("B2", "=PERCENTILE.INC(A1:A5, 0.5)");
    model._set("B3", "=PERCENTILE()");
    model.evaluate();
    assert_eq!(model._get_text("B1"), *"3");
    assert_eq!(model._get_text("B1"), model._get_text("B2"));
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

// ── PERCENTRANK ──────────────────────────────────────────────────────────────

#[test]
fn test_percentrank() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    // PERCENTRANK = PERCENTRANK.INC
    model._set("B1", "=PERCENTRANK(A1:A5, 3)");
    model._set("B2", "=PERCENTRANK.INC(A1:A5, 3)");
    model._set("B3", "=PERCENTRANK()");
    model.evaluate();
    assert_eq!(model._get_text("B1"), *"0.5");
    assert_eq!(model._get_text("B1"), model._get_text("B2"));
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

// ── POISSON ──────────────────────────────────────────────────────────────────

#[test]
fn test_poisson() {
    let mut model = new_empty_model();
    model._set("A1", "=POISSON(2, 3, TRUE)");
    model._set("A2", "=POISSON.DIST(2, 3, TRUE)");
    model._set("A3", "=POISSON()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── QUARTILE ─────────────────────────────────────────────────────────────────

#[test]
fn test_quartile() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    model._set("A4", "4");
    model._set("A5", "5");
    // QUARTILE = QUARTILE.INC
    model._set("B1", "=QUARTILE(A1:A5, 2)");
    model._set("B2", "=QUARTILE.INC(A1:A5, 2)");
    model._set("B3", "=QUARTILE()");
    model.evaluate();
    assert_eq!(model._get_text("B1"), *"3");
    assert_eq!(model._get_text("B1"), model._get_text("B2"));
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

// ── RANK ─────────────────────────────────────────────────────────────────────

#[test]
fn test_rank() {
    let mut model = new_empty_model();
    model._set("A1", "1");
    model._set("A2", "2");
    model._set("A3", "3");
    // RANK = RANK.EQ
    model._set("B1", "=RANK(2, A1:A3)");
    model._set("B2", "=RANK.EQ(2, A1:A3)");
    model._set("B3", "=RANK()");
    model.evaluate();
    assert_eq!(model._get_text("B1"), *"2");
    assert_eq!(model._get_text("B1"), model._get_text("B2"));
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

// ── STDEVP ───────────────────────────────────────────────────────────────────

#[test]
fn test_stdevp() {
    let mut model = new_empty_model();
    model._set("A1", "=STDEVP(2, 4, 4, 4, 5, 5, 7, 9)");
    model._set("A2", "=STDEV.P(2, 4, 4, 4, 5, 5, 7, 9)");
    model._set("A3", "=STDEVP()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── TDIST ────────────────────────────────────────────────────────────────────

#[test]
fn test_tdist() {
    let mut model = new_empty_model();
    // tails=1: right-tail = T.DIST.RT
    model._set("A1", "=TDIST(1, 10, 1)");
    model._set("A2", "=T.DIST.RT(1, 10)");
    // tails=2: two-tailed = T.DIST.2T
    model._set("A3", "=TDIST(1, 10, 2)");
    model._set("A4", "=T.DIST.2T(1, 10)");
    // x < 0 → #NUM!
    model._set("A5", "=TDIST(-1, 10, 1)");
    // tails not 1 or 2 → #NUM!
    model._set("A6", "=TDIST(1, 10, 3)");
    // wrong arg count
    model._set("A7", "=TDIST()");
    model._set("A8", "=TDIST(1, 10)");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), model._get_text("A4"));
    assert_eq!(model._get_text("A5"), *"#NUM!");
    assert_eq!(model._get_text("A6"), *"#NUM!");
    assert_eq!(model._get_text("A7"), *"#ERROR!");
    assert_eq!(model._get_text("A8"), *"#ERROR!");
}

// ── TINV ─────────────────────────────────────────────────────────────────────

#[test]
fn test_tinv() {
    let mut model = new_empty_model();
    // TINV(prob, deg_freedom) = T.INV.2T(prob, deg_freedom)
    model._set("A1", "=TINV(0.05, 10)");
    model._set("A2", "=T.INV.2T(0.05, 10)");
    model._set("A3", "=TINV()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── TTEST ────────────────────────────────────────────────────────────────────

#[test]
fn test_ttest() {
    let mut model = new_empty_model();
    model._set("A1", "3");
    model._set("A2", "4");
    model._set("A3", "5");
    model._set("B1", "6");
    model._set("B2", "19");
    model._set("B3", "3");
    // TTEST = T.TEST
    model._set("C1", "=TTEST(A1:A3, B1:B3, 2, 1)");
    model._set("C2", "=T.TEST(A1:A3, B1:B3, 2, 1)");
    model._set("C3", "=TTEST()");
    model.evaluate();
    assert_eq!(model._get_text("C1"), model._get_text("C2"));
    assert_eq!(model._get_text("C3"), *"#ERROR!");
}

// ── VAR ──────────────────────────────────────────────────────────────────────

#[test]
fn test_var() {
    let mut model = new_empty_model();
    model._set("A1", "=VAR(2, 4, 4, 4, 5, 5, 7, 9)");
    model._set("A2", "=VAR.S(2, 4, 4, 4, 5, 5, 7, 9)");
    model._set("A3", "=VAR()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── VARP ─────────────────────────────────────────────────────────────────────

#[test]
fn test_varp() {
    let mut model = new_empty_model();
    model._set("A1", "=VARP(2, 4, 4, 4, 5, 5, 7, 9)");
    model._set("A2", "=VAR.P(2, 4, 4, 4, 5, 5, 7, 9)");
    model._set("A3", "=VARP()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── WEIBULL ──────────────────────────────────────────────────────────────────

#[test]
fn test_weibull() {
    let mut model = new_empty_model();
    model._set("A1", "=WEIBULL(1, 1, 1, TRUE)");
    model._set("A2", "=WEIBULL.DIST(1, 1, 1, TRUE)");
    model._set("A3", "=WEIBULL()");
    model.evaluate();
    assert_eq!(model._get_text("A1"), model._get_text("A2"));
    assert_eq!(model._get_text("A3"), *"#ERROR!");
}

// ── ZTEST ────────────────────────────────────────────────────────────────────

#[test]
fn test_ztest() {
    let mut model = new_empty_model();
    model._set("A1", "3");
    model._set("A2", "6");
    model._set("A3", "7");
    model._set("A4", "8");
    model._set("A5", "9");
    // ZTEST = Z.TEST
    model._set("B1", "=ZTEST(A1:A5, 4)");
    model._set("B2", "=Z.TEST(A1:A5, 4)");
    model._set("B3", "=ZTEST()");
    model.evaluate();
    assert_eq!(model._get_text("B1"), model._get_text("B2"));
    assert_eq!(model._get_text("B3"), *"#ERROR!");
}

#[test]
fn test_formula_roundtrip() {
    let mut model = new_empty_model();

    // Set up data ranges needed for array-arg functions
    model._set("D1", "3");
    model._set("D2", "9");
    model._set("D3", "2");
    model._set("E1", "5");
    model._set("E2", "15");
    model._set("E3", "6");

    model._set("A1", "=BETADIST(0.5, 2, 2)");
    model._set("A2", "=BETAINV(0.5, 2, 2)");
    model._set("A3", "=BINOMDIST(2, 5, 0.5, TRUE)");
    model._set("A4", "=CHIDIST(3.5, 4)");
    model._set("A5", "=CHIINV(0.05, 4)");
    model._set("A6", "=CHITEST(D1:D3, E1:E3)");
    model._set("A7", "=CONFIDENCE(0.05, 2, 100)");
    model._set("A8", "=COVAR(D1:D3, E1:E3)");
    model._set("A9", "=CRITBINOM(6, 0.5, 0.75)");
    model._set("A10", "=EXPONDIST(1, 1, TRUE)");
    model._set("A11", "=FDIST(3, 4, 5)");
    model._set("A12", "=FINV(0.1, 4, 5)");
    model._set("A13", "=FTEST(D1:D3, E1:E3)");
    model._set("A14", "=GAMMADIST(5, 2, 2, TRUE)");
    model._set("A15", "=GAMMAINV(0.5, 2, 2)");
    model._set("A16", "=HYPGEOMDIST(1, 4, 2, 8)");
    model._set("A17", "=LOGINV(0.5, 0, 1)");
    model._set("A18", "=LOGNORMDIST(1, 0, 1)");
    model._set("A19", "=MODE(1, 2, 2, 3)");
    model._set("A20", "=NEGBINOMDIST(2, 5, 0.5)");
    model._set("A21", "=NORMDIST(0, 0, 1, TRUE)");
    model._set("A22", "=NORMINV(0.5, 0, 1)");
    model._set("A23", "=NORMSDIST(0)");
    model._set("A24", "=NORMSINV(0.5)");
    model._set("A25", "=PERCENTILE(D1:D3, 0.5)");
    model._set("A26", "=PERCENTRANK(D1:D3, 3)");
    model._set("A27", "=POISSON(2, 3, TRUE)");
    model._set("A28", "=QUARTILE(D1:D3, 2)");
    model._set("A29", "=RANK(2, D1:D3)");
    model._set("A30", "=STDEVP(2, 4, 4, 5)");
    model._set("A31", "=TDIST(1, 10, 2)");
    model._set("A32", "=TINV(0.05, 10)");
    model._set("A33", "=TTEST(D1:D3, E1:E3, 2, 1)");
    model._set("A34", "=VAR(2, 4, 4, 5)");
    model._set("A35", "=VARP(2, 4, 4, 5)");
    model._set("A36", "=WEIBULL(1, 1, 1, TRUE)");
    model._set("A37", "=ZTEST(D1:D3, 4)");

    model.evaluate();

    assert_eq!(model._get_formula("A1"), "=BETADIST(0.5,2,2)");
    assert_eq!(model._get_formula("A2"), "=BETAINV(0.5,2,2)");
    assert_eq!(model._get_formula("A3"), "=BINOMDIST(2,5,0.5,TRUE)");
    assert_eq!(model._get_formula("A4"), "=CHIDIST(3.5,4)");
    assert_eq!(model._get_formula("A5"), "=CHIINV(0.05,4)");
    assert_eq!(model._get_formula("A6"), "=CHITEST(D1:D3,E1:E3)");
    assert_eq!(model._get_formula("A7"), "=CONFIDENCE(0.05,2,100)");
    assert_eq!(model._get_formula("A8"), "=COVAR(D1:D3,E1:E3)");
    assert_eq!(model._get_formula("A9"), "=CRITBINOM(6,0.5,0.75)");
    assert_eq!(model._get_formula("A10"), "=EXPONDIST(1,1,TRUE)");
    assert_eq!(model._get_formula("A11"), "=FDIST(3,4,5)");
    assert_eq!(model._get_formula("A12"), "=FINV(0.1,4,5)");
    assert_eq!(model._get_formula("A13"), "=FTEST(D1:D3,E1:E3)");
    assert_eq!(model._get_formula("A14"), "=GAMMADIST(5,2,2,TRUE)");
    assert_eq!(model._get_formula("A15"), "=GAMMAINV(0.5,2,2)");
    assert_eq!(model._get_formula("A16"), "=HYPGEOMDIST(1,4,2,8)");
    assert_eq!(model._get_formula("A17"), "=LOGINV(0.5,0,1)");
    assert_eq!(model._get_formula("A18"), "=LOGNORMDIST(1,0,1)");
    assert_eq!(model._get_formula("A19"), "=MODE(1,2,2,3)");
    assert_eq!(model._get_formula("A20"), "=NEGBINOMDIST(2,5,0.5)");
    assert_eq!(model._get_formula("A21"), "=NORMDIST(0,0,1,TRUE)");
    assert_eq!(model._get_formula("A22"), "=NORMINV(0.5,0,1)");
    assert_eq!(model._get_formula("A23"), "=NORMSDIST(0)");
    assert_eq!(model._get_formula("A24"), "=NORMSINV(0.5)");
    assert_eq!(model._get_formula("A25"), "=PERCENTILE(D1:D3,0.5)");
    assert_eq!(model._get_formula("A26"), "=PERCENTRANK(D1:D3,3)");
    assert_eq!(model._get_formula("A27"), "=POISSON(2,3,TRUE)");
    assert_eq!(model._get_formula("A28"), "=QUARTILE(D1:D3,2)");
    assert_eq!(model._get_formula("A29"), "=RANK(2,D1:D3)");
    assert_eq!(model._get_formula("A30"), "=STDEVP(2,4,4,5)");
    assert_eq!(model._get_formula("A31"), "=TDIST(1,10,2)");
    assert_eq!(model._get_formula("A32"), "=TINV(0.05,10)");
    assert_eq!(model._get_formula("A33"), "=TTEST(D1:D3,E1:E3,2,1)");
    assert_eq!(model._get_formula("A34"), "=VAR(2,4,4,5)");
    assert_eq!(model._get_formula("A35"), "=VARP(2,4,4,5)");
    assert_eq!(model._get_formula("A36"), "=WEIBULL(1,1,1,TRUE)");
    assert_eq!(model._get_formula("A37"), "=ZTEST(D1:D3,4)");
}
