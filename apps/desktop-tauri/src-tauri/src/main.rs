// Keeps the Windows release build free of an extra console window.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ikguide_studio_lib::run()
}
